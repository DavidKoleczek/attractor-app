use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::process::Command;
use tokio::sync::RwLock;

use crate::models::{Comment, Issue, SimpleUser};
use crate::storage;

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AmplifierResult {
    pub response: String,
    pub session_id: String,
    pub model: String,
    pub error: Option<String>,
}

#[allow(dead_code)]
pub struct AmplifierSession {
    pub issue_number: u64,
    pub owner: String,
    pub repo: String,
    pub project_path: String,
    pub status: SessionStatus,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub result: Option<AmplifierResult>,
    /// Handle to the child process for cancellation.
    pub child_id: Option<u32>,
}

/// Serializable info returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AmplifierSessionInfo {
    pub issue_number: u64,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub error: Option<String>,
}

impl From<&AmplifierSession> for AmplifierSessionInfo {
    fn from(s: &AmplifierSession) -> Self {
        Self {
            issue_number: s.issue_number,
            status: match s.status {
                SessionStatus::Running => "running".to_string(),
                SessionStatus::Completed => "completed".to_string(),
                SessionStatus::Failed => "failed".to_string(),
            },
            started_at: s.started_at.to_rfc3339(),
            finished_at: s.finished_at.map(|t| t.to_rfc3339()),
            error: s.result.as_ref().and_then(|r| r.error.clone()),
        }
    }
}

// ---------------------------------------------------------------------------
// AmplifierManager
// ---------------------------------------------------------------------------

/// Registry of all Amplifier sessions, keyed by "{owner}/{repo}#{issue_number}".
pub struct AmplifierManager {
    pub sessions: RwLock<HashMap<String, AmplifierSession>>,
}

impl AmplifierManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }
}

/// Build the session key for the registry.
pub fn session_key(owner: &str, repo: &str, issue_number: u64) -> String {
    format!("{}/{}#{}", owner, repo, issue_number)
}

// ---------------------------------------------------------------------------
// Amplifier CLI JSON output
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AmplifierJsonOutput {
    pub status: String,
    #[serde(default)]
    pub response: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_type: Option<String>,
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/// Extract a JSON object from stdout that may contain ANSI escape codes and
/// TUI progress output mixed in. Tries the full string first (fast path),
/// then scans for the last top-level `{...}` block.
fn extract_json(raw: &str) -> Option<AmplifierJsonOutput> {
    // Fast path: stdout is clean JSON
    if let Ok(parsed) = serde_json::from_str::<AmplifierJsonOutput>(raw) {
        return Some(parsed);
    }

    // Slow path: find the last `{` that opens a valid JSON object.
    // Amplifier emits the JSON as the final output, so scanning from the
    // end is the most reliable strategy.
    let bytes = raw.as_bytes();
    for start in (0..bytes.len()).rev() {
        if bytes[start] == b'{' {
            if let Ok(parsed) = serde_json::from_str::<AmplifierJsonOutput>(&raw[start..]) {
                return Some(parsed);
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

pub fn build_prompt(issue: &Issue) -> String {
    let mut prompt = format!("Issue #{}: {}", issue.number, issue.title);
    if let Some(body) = &issue.body {
        if !body.is_empty() {
            prompt.push_str(&format!("\n\n{}", body));
        }
    }
    prompt
}

// ---------------------------------------------------------------------------
// Bot user
// ---------------------------------------------------------------------------

fn amplifier_bot_user() -> SimpleUser {
    SimpleUser {
        login: "attractor-bot".to_string(),
        id: 0,
        avatar_url: String::new(),
        user_type: "Bot".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Settings file management
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS_YAML: &str = r#"config:
  providers:
  - module: provider-anthropic
    config:
      api_key: ${ANTHROPIC_API_KEY}
      base_url: https://api.anthropic.com
      default_model: claude-opus-4-6
      enable_prompt_caching: 'true'
      priority: 1
    source: git+https://github.com/microsoft/amplifier-module-provider-anthropic@main
"#;

/// Ensure `.amplifier/settings.local.yaml` exists in the project directory.
/// If not, write the canonical default.
fn ensure_settings_file(project_path: &Path) -> Result<(), String> {
    let amplifier_dir = project_path.join(".amplifier");
    let settings_file = amplifier_dir.join("settings.local.yaml");
    if !settings_file.exists() {
        std::fs::create_dir_all(&amplifier_dir)
            .map_err(|e| format!("Failed to create .amplifier dir: {}", e))?;
        std::fs::write(&settings_file, DEFAULT_SETTINGS_YAML)
            .map_err(|e| format!("Failed to write settings.local.yaml: {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Spawn logic
// ---------------------------------------------------------------------------

/// Spawn an Amplifier CLI session as a background process.
/// Returns immediately after starting; the background task handles completion.
pub async fn spawn_session(
    app: tauri::AppHandle,
    manager: tauri::State<'_, AmplifierManager>,
    store_repo_path: std::path::PathBuf,
    token: String,
    user_login: String,
    owner: String,
    repo: String,
    issue: Issue,
    project_path: String,
) -> Result<(), String> {
    let issue_number = issue.number;
    let key = session_key(&owner, &repo, issue_number);

    // Prevent duplicate sessions for the same issue
    {
        let sessions = manager.sessions.read().await;
        if let Some(existing) = sessions.get(&key) {
            if existing.status == SessionStatus::Running {
                return Err(format!(
                    "Amplifier session already running for issue #{}",
                    issue_number
                ));
            }
        }
    }

    // Ensure settings file exists
    ensure_settings_file(Path::new(&project_path))?;

    // Build the prompt
    let prompt = build_prompt(&issue);

    // Spawn the child process
    let child = Command::new("amplifier")
        .arg("run")
        .arg("--output-format")
        .arg("json")
        .arg(&prompt)
        .current_dir(&project_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn amplifier: {}", e))?;

    let child_id = child.id();

    // Register session as Running
    {
        let mut sessions = manager.sessions.write().await;
        sessions.insert(
            key.clone(),
            AmplifierSession {
                issue_number,
                owner: owner.clone(),
                repo: repo.clone(),
                project_path: project_path.clone(),
                status: SessionStatus::Running,
                started_at: Utc::now(),
                finished_at: None,
                result: None,
                child_id,
            },
        );
    }

    // Emit started event
    use tauri::Emitter;
    let _ = app.emit(
        "amplifier:started",
        serde_json::json!({
            "issueNumber": issue_number,
            "owner": &owner,
            "repo": &repo,
        }),
    );

    // Spawn background task to wait for completion
    let app_clone = app.clone();
    tokio::spawn(async move {
        let output = child.wait_with_output().await;

        let manager = app_clone.state::<AmplifierManager>();

        match output {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();

                // Parse the JSON output (handles ANSI/TUI noise in stdout)
                let parsed: Option<AmplifierJsonOutput> = extract_json(&stdout);

                let (comment_body, status, result) = match parsed {
                    Some(ref json_out) if json_out.status == "success" => {
                        let body = json_out.response.clone();
                        let res = AmplifierResult {
                            response: json_out.response.clone(),
                            session_id: json_out.session_id.clone(),
                            model: json_out.model.clone(),
                            error: None,
                        };
                        (body, SessionStatus::Completed, res)
                    }
                    Some(ref json_out) => {
                        let err_msg = json_out
                            .error
                            .clone()
                            .unwrap_or_else(|| "Unknown error".to_string());
                        let body =
                            format!("Amplifier session failed: {}", err_msg);
                        let res = AmplifierResult {
                            response: String::new(),
                            session_id: json_out.session_id.clone(),
                            model: json_out.model.clone(),
                            error: Some(err_msg),
                        };
                        (body, SessionStatus::Failed, res)
                    }
                    None => {
                        // Could not parse JSON -- use stderr or exit code
                        let err_msg = if !stderr.is_empty() {
                            // Take just the last few lines of stderr for the comment
                            let lines: Vec<&str> = stderr.lines().collect();
                            let tail: Vec<&str> = lines
                                .iter()
                                .rev()
                                .take(10)
                                .rev()
                                .copied()
                                .collect();
                            tail.join("\n")
                        } else {
                            format!(
                                "Process exited with code {}",
                                output.status.code().unwrap_or(-1)
                            )
                        };
                        let body =
                            format!("Amplifier session failed: {}", err_msg);
                        let res = AmplifierResult {
                            response: String::new(),
                            session_id: String::new(),
                            model: String::new(),
                            error: Some(err_msg),
                        };
                        (body, SessionStatus::Failed, res)
                    }
                };

                let is_success = status == SessionStatus::Completed;

                // Write comment to storage
                let comment_id = write_session_comment(
                    &store_repo_path,
                    issue_number,
                    &comment_body,
                    &token,
                    &user_login,
                );

                // Update session state
                {
                    let mut sessions = manager.sessions.write().await;
                    if let Some(session) = sessions.get_mut(&key) {
                        session.status = status;
                        session.finished_at = Some(Utc::now());
                        session.result = Some(result);
                        session.child_id = None;
                    }
                }

                // Emit completion event
                use tauri::Emitter;
                if is_success {
                    let _ = app_clone.emit(
                        "amplifier:completed",
                        serde_json::json!({
                            "issueNumber": issue_number,
                            "owner": &owner,
                            "repo": &repo,
                            "commentId": comment_id.unwrap_or(0),
                        }),
                    );
                } else {
                    let _ = app_clone.emit(
                        "amplifier:failed",
                        serde_json::json!({
                            "issueNumber": issue_number,
                            "owner": &owner,
                            "repo": &repo,
                            "error": &comment_body,
                        }),
                    );
                }
            }
            Err(e) => {
                // Process wait failed entirely
                let error_msg = format!("Failed to wait on amplifier process: {}", e);
                {
                    let mut sessions = manager.sessions.write().await;
                    if let Some(session) = sessions.get_mut(&key) {
                        session.status = SessionStatus::Failed;
                        session.finished_at = Some(Utc::now());
                        session.result = Some(AmplifierResult {
                            response: String::new(),
                            session_id: String::new(),
                            model: String::new(),
                            error: Some(error_msg.clone()),
                        });
                        session.child_id = None;
                    }
                }
                use tauri::Emitter;
                let _ = app_clone.emit(
                    "amplifier:failed",
                    serde_json::json!({
                        "issueNumber": issue_number,
                        "owner": &owner,
                        "repo": &repo,
                        "error": &error_msg,
                    }),
                );
            }
        }
    });

    Ok(())
}

/// Write a comment to storage, update meta + issue comment count, commit + push.
/// Returns the comment ID on success.
fn write_session_comment(
    store_repo_path: &Path,
    issue_number: u64,
    body: &str,
    token: &str,
    user_login: &str,
) -> Option<u64> {
    let result: Result<u64, String> = (|| {
        // Sync first
        storage::sync_repo(store_repo_path, token)
            .map_err(|e| format!("Sync failed: {}", e))?;

        let mut meta = storage::read_meta(store_repo_path)
            .map_err(|e| format!("Read meta failed: {}", e))?;
        let comment_id = meta.next_comment_id;
        meta.next_comment_id += 1;

        let now = Utc::now();
        let comment = Comment {
            id: comment_id,
            body: body.to_string(),
            user: amplifier_bot_user(),
            created_at: now,
            updated_at: now,
            author_association: "BOT".to_string(),
        };

        storage::write_comment(store_repo_path, issue_number, &comment)
            .map_err(|e| format!("Write comment failed: {}", e))?;
        storage::write_meta(store_repo_path, &meta)
            .map_err(|e| format!("Write meta failed: {}", e))?;

        // Bump comment count on the issue
        if let Ok(mut issue) = storage::read_issue(store_repo_path, issue_number) {
            issue.comments += 1;
            issue.updated_at = now;
            let _ = storage::write_issue(store_repo_path, &issue);
        }

        let author_email = format!("{}@users.noreply.github.com", user_login);
        storage::commit_and_push(
            store_repo_path,
            &format!("attractor: session result for issue #{}", issue_number),
            user_login,
            &author_email,
            token,
        )
        .map_err(|e| format!("Commit/push failed: {}", e))?;

        Ok(comment_id)
    })();

    match result {
        Ok(id) => Some(id),
        Err(e) => {
            eprintln!("Error writing session comment: {}", e);
            None
        }
    }
}
