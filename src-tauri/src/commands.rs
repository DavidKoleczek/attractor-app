use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::amplifier::{self, AmplifierManager, AmplifierSessionInfo};
use crate::error::AppError;
use crate::github;
use crate::models::*;
use crate::state::AppState;
use crate::storage;

/// Prefix used for backing-store repo names on GitHub.
const STORE_PREFIX: &str = "attractor-store-";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn is_wsl() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|v| v.to_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

fn require_token(state: &AppState) -> Result<String, String> {
    state
        .token
        .read()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone()
        .ok_or_else(|| "Not authenticated – call set_token first".to_string())
}

fn require_user(state: &AppState) -> Result<SimpleUser, String> {
    state
        .user
        .read()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone()
        .ok_or_else(|| "Not authenticated – call set_token first".to_string())
}

fn repo_path(state: &AppState, owner: &str, repo: &str) -> std::path::PathBuf {
    state.repos_dir.join(owner).join(repo)
}

fn author_email(login: &str) -> String {
    format!("{}@users.noreply.github.com", login)
}

/// Persist recent projects to the store.
fn save_recent_projects(app: &tauri::AppHandle, projects: &[RecentProject]) {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        let _ = store.set("recent_projects", serde_json::json!(projects));
    }
}

/// Load recent projects from the store.
fn load_recent_projects(app: &tauri::AppHandle) -> Vec<RecentProject> {
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        if let Some(val) = store.get("recent_projects") {
            if let Ok(projects) = serde_json::from_value::<Vec<RecentProject>>(val.clone()) {
                return projects;
            }
        }
    }
    Vec::new()
}

/// Add or update a project in the recent projects list and persist.
fn upsert_recent_project(app: &tauri::AppHandle, project: &RecentProject) {
    let mut projects = load_recent_projects(app);
    projects.retain(|p| p.local_path != project.local_path);
    projects.insert(0, project.clone());
    // Keep at most 20 recent projects
    projects.truncate(20);
    save_recent_projects(app, &projects);
}

/// Build a structured error for repo-creation-forbidden that the frontend can parse.
fn repo_create_forbidden_error(owner: &str, repo_name: &str, project_path: &str) -> String {
    format!(
        "REPO_CREATE_FORBIDDEN:{}",
        serde_json::json!({
            "owner": owner,
            "repo_name": repo_name,
            "project_path": project_path,
        })
    )
}

// ===================================================================
//  Auth commands
// ===================================================================

#[tauri::command]
pub async fn set_token(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    token: String,
) -> Result<SimpleUser, String> {
    // Validate by hitting the GitHub API
    let user = github::get_authenticated_user(&token)
        .await
        .map_err(|e| e.to_string())?;

    // Store in memory
    {
        let mut guard = app_state
            .token
            .write()
            .map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(token.clone());
    }
    {
        let mut guard = app_state
            .user
            .write()
            .map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(user.clone());
    }

    // Persist to disk via tauri-plugin-store
    use tauri_plugin_store::StoreExt;
    if let Ok(store) = app.store("settings.json") {
        let _ = store.set("token", serde_json::json!(token));
    }

    Ok(user)
}

#[tauri::command]
pub async fn get_token(app_state: State<'_, AppState>) -> Result<Option<String>, String> {
    app_state
        .token
        .read()
        .map(|g| g.clone())
        .map_err(|e| format!("Lock error: {}", e))
}

#[tauri::command]
pub async fn validate_token(token: String) -> Result<SimpleUser, String> {
    github::get_authenticated_user(&token)
        .await
        .map_err(|e| e.to_string())
}

// ===================================================================
//  Project commands
// ===================================================================

#[tauri::command]
pub async fn list_projects(
    app_state: State<'_, AppState>,
    prefix: String,
) -> Result<Vec<RepoInfo>, String> {
    let token = require_token(&app_state)?;
    github::list_repos(&token, &prefix)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_project(
    app_state: State<'_, AppState>,
    name: String,
    description: String,
    private: Option<bool>,
) -> Result<RepoInfo, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let is_private = private.unwrap_or(true);

    let repo_name = if name.starts_with(STORE_PREFIX) {
        name.clone()
    } else {
        format!("{}{}", STORE_PREFIX, name)
    };

    // Create the GitHub repository (auto_init gives us a first commit)
    let repo_info = github::create_repo(&token, &repo_name, &description, is_private)
        .await
        .map_err(|e| e.to_string())?;

    // Clone locally and bootstrap .attractor/ structure
    let path = repo_path(&app_state, &repo_info.owner.login, &repo_info.name);
    let clone_url = repo_info.clone_url.clone();
    let tok = token.clone();
    let login = user.login.clone();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&clone_url, &path, &tok)?;
        storage::init_repo_structure(&path)?;
        storage::commit_and_push(
            &path,
            "Initialize attractor structure",
            &login,
            &author_email(&login),
            &tok,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(repo_info)
}

#[tauri::command]
pub async fn select_project(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    local_path: String,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);
    let clone_url = format!("https://github.com/{}/{}.git", owner, repo);
    let tok = token.clone();
    let path_c = path.clone();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&clone_url, &path_c, &tok)?;
        storage::sync_repo(&path_c, &tok)?;
        if !path_c.join(".attractor").exists() {
            storage::init_repo_structure(&path_c)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Remember the selection
    let info = RepoInfo {
        id: 0,
        name: repo.clone(),
        full_name: format!("{}/{}", owner, repo),
        description: None,
        private: false,
        html_url: format!("https://github.com/{}/{}", owner, repo),
        clone_url: format!("https://github.com/{}/{}.git", owner, repo),
        owner: SimpleUser {
            login: owner,
            id: 0,
            avatar_url: String::new(),
            user_type: "User".to_string(),
        },
    };
    {
        let mut guard = app_state
            .current_repo
            .write()
            .map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(info);
    }
    {
        let mut guard = app_state
            .current_project_path
            .write()
            .map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(local_path);
    }

    Ok(())
}

#[tauri::command]
pub async fn list_recent_projects(
    app: tauri::AppHandle,
) -> Result<Vec<RecentProject>, String> {
    Ok(load_recent_projects(&app))
}

#[tauri::command]
pub async fn remove_recent_project(
    app: tauri::AppHandle,
    local_path: String,
) -> Result<(), String> {
    let mut projects = load_recent_projects(&app);
    projects.retain(|p| p.local_path != local_path);
    save_recent_projects(&app, &projects);
    Ok(())
}

#[tauri::command]
pub async fn create_local_project(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    parent_path: String,
    folder_name: String,
) -> Result<RecentProject, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;

    let project_path = std::path::PathBuf::from(&parent_path).join(&folder_name);

    // Create the local folder
    std::fs::create_dir_all(&project_path).map_err(|e| format!("Failed to create folder: {}", e))?;

    // Resolve a unique backing repo name
    let base_name = format!("{}{}", STORE_PREFIX, folder_name);
    let owner = user.login.clone();
    let repo_name = resolve_backing_repo_name(&token, &owner, &base_name)
        .await
        .map_err(|e| e.to_string())?;

    // Create the backing store GH repo
    let repo_info = match github::create_repo(&token, &repo_name, &format!("Attractor backing store for {}", folder_name), true).await {
        Ok(info) => info,
        Err(AppError::RepoCreationForbidden(_)) => {
            return Err(repo_create_forbidden_error(&owner, &repo_name, &project_path.to_string_lossy()));
        }
        Err(e) => return Err(e.to_string()),
    };

    // Generate a unique store ID to link project <-> store
    let store_id = Uuid::new_v4().to_string();

    // Clone and init backing store
    let backing_path = repo_path(&app_state, &owner, &repo_name);
    let clone_url = repo_info.clone_url.clone();
    let tok = token.clone();
    let login = user.login.clone();
    let sid = store_id.clone();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&clone_url, &backing_path, &tok)?;
        storage::init_repo_structure(&backing_path)?;
        storage::write_store_manifest(&backing_path, &StoreManifest { store_id: sid })?;
        storage::commit_and_push(
            &backing_path,
            "Initialize attractor structure",
            &login,
            &author_email(&login),
            &tok,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Write .amplifier/attractor.json in the project folder
    let config = AttractorConfig {
        owner: owner.clone(),
        repo: repo_name.clone(),
        store_id,
    };
    storage::write_attractor_config(&project_path, &config)
        .map_err(|e| e.to_string())?;

    // Track as current project
    {
        let mut guard = app_state.current_project_path.write().map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(project_path.to_string_lossy().to_string());
    }

    let project = RecentProject {
        local_path: project_path.to_string_lossy().to_string(),
        owner: owner.clone(),
        repo: repo_name.clone(),
        last_opened: Utc::now(),
    };
    upsert_recent_project(&app, &project);

    Ok(project)
}

#[tauri::command]
pub async fn create_github_project(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    repo_name: String,
    description: String,
    is_private: bool,
    parent_path: String,
) -> Result<RecentProject, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let owner = user.login.clone();

    // Create the project GH repo
    match github::create_repo(&token, &repo_name, &description, is_private).await {
        Ok(_) => {}
        Err(AppError::RepoCreationForbidden(_)) => {
            return Err(format!(
                "Your token doesn't have permission to create repositories. \
                 Please create '{}' on GitHub, then use 'Open Existing Project' to open it.",
                repo_name
            ));
        }
        Err(e) => return Err(e.to_string()),
    };

    // Create the backing store GH repo
    let backing_name_base = format!("{}{}", STORE_PREFIX, repo_name);
    let backing_name = resolve_backing_repo_name(&token, &owner, &backing_name_base)
        .await
        .map_err(|e| e.to_string())?;

    let backing_info = match github::create_repo(&token, &backing_name, &format!("Attractor backing store for {}", repo_name), true).await {
        Ok(info) => info,
        Err(AppError::RepoCreationForbidden(_)) => {
            let project_path = std::path::PathBuf::from(&parent_path).join(&repo_name);
            return Err(repo_create_forbidden_error(&owner, &backing_name, &project_path.to_string_lossy()));
        }
        Err(e) => return Err(e.to_string()),
    };

    // Generate a unique store ID to link project <-> store
    let store_id = Uuid::new_v4().to_string();

    // Clone project repo locally
    let project_path = std::path::PathBuf::from(&parent_path).join(&repo_name);
    let project_clone_url = format!("https://github.com/{}/{}.git", owner, repo_name);
    let tok1 = token.clone();
    let pp = project_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&project_clone_url, &pp, &tok1)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Clone and init backing store
    let backing_path = repo_path(&app_state, &owner, &backing_name);
    let backing_clone_url = backing_info.clone_url.clone();
    let tok2 = token.clone();
    let login = user.login.clone();
    let sid = store_id.clone();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&backing_clone_url, &backing_path, &tok2)?;
        storage::init_repo_structure(&backing_path)?;
        storage::write_store_manifest(&backing_path, &StoreManifest { store_id: sid })?;
        storage::commit_and_push(
            &backing_path,
            "Initialize attractor structure",
            &login,
            &author_email(&login),
            &tok2,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Write .amplifier/attractor.json in the project folder
    let config = AttractorConfig {
        owner: owner.clone(),
        repo: backing_name.clone(),
        store_id,
    };
    storage::write_attractor_config(&project_path, &config)
        .map_err(|e| e.to_string())?;

    // Commit .amplifier/ to project repo
    let tok3 = token.clone();
    let login2 = user.login.clone();
    let pp2 = project_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        // Stage and commit .amplifier/
        let repo = git2::Repository::open(&pp2)?;
        let mut index = repo.index()?;
        index.add_all([".amplifier"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;
        let parent = repo.head()?.peel_to_commit()?;
        let sig = git2::Signature::now(&login2, &author_email(&login2))?;
        repo.commit(Some("HEAD"), &sig, &sig, "Add attractor config", &tree, &[&parent])?;

        // Push
        let mut remote = repo.find_remote("origin")?;
        let mut callbacks = git2::RemoteCallbacks::new();
        let t = tok3.clone();
        callbacks.credentials(move |_url, _username, _allowed| {
            git2::Cred::userpass_plaintext("x-access-token", &t)
        });
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        let head = repo.head()?;
        let branch = head.shorthand().unwrap_or("main");
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
        remote.push(&[&refspec], Some(&mut push_opts))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Track
    {
        let mut guard = app_state.current_project_path.write().map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(project_path.to_string_lossy().to_string());
    }

    let project = RecentProject {
        local_path: project_path.to_string_lossy().to_string(),
        owner: owner.clone(),
        repo: backing_name.clone(),
        last_opened: Utc::now(),
    };
    upsert_recent_project(&app, &project);

    Ok(project)
}

#[tauri::command]
pub async fn open_local_project(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    folder_path: String,
) -> Result<RecentProject, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let project_path = std::path::PathBuf::from(&folder_path);

    if !project_path.exists() || !project_path.is_dir() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }

    // Check for existing .amplifier/attractor.json
    let config = storage::read_attractor_config(&project_path)
        .map_err(|e| e.to_string())?;

    let (owner, repo_name) = if let Some(cfg) = config {
        (cfg.owner, cfg.repo)
    } else {
        // Auto-create backing store
        let folder_name = project_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string());
        let base_name = format!("{}{}", STORE_PREFIX, folder_name);
        let owner = user.login.clone();
        let resolved_name = resolve_backing_repo_name(&token, &owner, &base_name)
            .await
            .map_err(|e| e.to_string())?;

        let repo_info = match github::create_repo(&token, &resolved_name, &format!("Attractor backing store for {}", folder_name), true).await {
            Ok(info) => info,
            Err(AppError::RepoCreationForbidden(_)) => {
                return Err(repo_create_forbidden_error(&user.login, &resolved_name, &folder_path));
            }
            Err(e) => return Err(e.to_string()),
        };

        // Generate a unique store ID
        let store_id = Uuid::new_v4().to_string();

        // Clone and init backing store
        let backing_path = repo_path(&app_state, &owner, &resolved_name);
        let clone_url = repo_info.clone_url.clone();
        let tok = token.clone();
        let login = user.login.clone();
        let sid = store_id.clone();

        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            storage::clone_or_open_repo(&clone_url, &backing_path, &tok)?;
            storage::init_repo_structure(&backing_path)?;
            storage::write_store_manifest(&backing_path, &StoreManifest { store_id: sid })?;
            storage::commit_and_push(
                &backing_path,
                "Initialize attractor structure",
                &login,
                &author_email(&login),
                &tok,
            )?;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        // Write config
        let cfg = AttractorConfig {
            owner: owner.clone(),
            repo: resolved_name.clone(),
            store_id,
        };
        storage::write_attractor_config(&project_path, &cfg)
            .map_err(|e| e.to_string())?;

        (owner, resolved_name)
    };

    // Ensure backing store is cloned and synced
    let backing_path = repo_path(&app_state, &owner, &repo_name);
    let clone_url = format!("https://github.com/{}/{}.git", owner, repo_name);
    let tok = token.clone();
    let pp = project_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&clone_url, &backing_path, &tok)?;
        storage::sync_repo(&backing_path, &tok)?;
        if !backing_path.join(".attractor").exists() {
            storage::init_repo_structure(&backing_path)?;
        }
        // Validate store ID if both sides have one
        validate_store_id(&pp, &backing_path)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Track
    {
        let mut guard = app_state.current_project_path.write().map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(folder_path.clone());
    }

    let project = RecentProject {
        local_path: folder_path.clone(),
        owner: owner.clone(),
        repo: repo_name.clone(),
        last_opened: Utc::now(),
    };
    upsert_recent_project(&app, &project);

    Ok(project)
}

/// Open an existing GitHub repo as a *project* (not a backing store).
/// Clones the project repo locally, then reads .amplifier/attractor.json to
/// find the backing store. If no config exists, auto-creates one.
#[tauri::command]
pub async fn open_github_project(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    parent_path: String,
) -> Result<RecentProject, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;

    // Clone the PROJECT repo locally
    let project_path = std::path::PathBuf::from(&parent_path).join(&repo);
    let project_clone_url = format!("https://github.com/{}/{}.git", owner, repo);
    let tok = token.clone();
    let pp = project_path.clone();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&project_clone_url, &pp, &tok)?;
        storage::sync_repo(&pp, &tok)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Now treat it exactly like open_local_project: read .amplifier/ or create backing store
    let config = storage::read_attractor_config(&project_path)
        .map_err(|e| e.to_string())?;

    let (backing_owner, backing_repo) = if let Some(cfg) = config {
        (cfg.owner, cfg.repo)
    } else {
        // Auto-create backing store
        let base_name = format!("{}{}", STORE_PREFIX, repo);
        let resolved = resolve_backing_repo_name(&token, &user.login, &base_name)
            .await
            .map_err(|e| e.to_string())?;

        let repo_info = match github::create_repo(
            &token,
            &resolved,
            &format!("Attractor backing store for {}", repo),
            true,
        ).await {
            Ok(info) => info,
            Err(AppError::RepoCreationForbidden(_)) => {
                return Err(repo_create_forbidden_error(&user.login, &resolved, &project_path.to_string_lossy()));
            }
            Err(e) => return Err(e.to_string()),
        };

        // Generate a unique store ID
        let store_id = Uuid::new_v4().to_string();

        // Clone and init backing store
        let bp = repo_path(&app_state, &user.login, &resolved);
        let clone_url = repo_info.clone_url.clone();
        let tok2 = token.clone();
        let login = user.login.clone();
        let sid = store_id.clone();

        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            storage::clone_or_open_repo(&clone_url, &bp, &tok2)?;
            storage::init_repo_structure(&bp)?;
            storage::write_store_manifest(&bp, &StoreManifest { store_id: sid })?;
            storage::commit_and_push(
                &bp,
                "Initialize attractor structure",
                &login,
                &author_email(&login),
                &tok2,
            )?;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        // Write config into the project repo
        let cfg = AttractorConfig {
            owner: user.login.clone(),
            repo: resolved.clone(),
            store_id,
        };
        storage::write_attractor_config(&project_path, &cfg)
            .map_err(|e| e.to_string())?;

        (user.login.clone(), resolved)
    };

    // Ensure backing store is cloned and synced
    let bp = repo_path(&app_state, &backing_owner, &backing_repo);
    let clone_url = format!("https://github.com/{}/{}.git", backing_owner, backing_repo);
    let tok3 = token.clone();
    let pp2 = project_path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&clone_url, &bp, &tok3)?;
        storage::sync_repo(&bp, &tok3)?;
        if !bp.join(".attractor").exists() {
            storage::init_repo_structure(&bp)?;
        }
        // Validate store ID if both sides have one
        validate_store_id(&pp2, &bp)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Track
    let local = project_path.to_string_lossy().to_string();
    {
        let mut guard = app_state.current_project_path.write().map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(local.clone());
    }

    let project = RecentProject {
        local_path: local,
        owner: backing_owner,
        repo: backing_repo,
        last_opened: Utc::now(),
    };
    upsert_recent_project(&app, &project);

    Ok(project)
}

/// Validate that the project's store_id matches the backing store's manifest.
/// Skips validation if either side is missing (legacy or first-time setup).
fn validate_store_id(
    project_path: &std::path::Path,
    store_repo_path: &std::path::Path,
) -> Result<(), AppError> {
    let config = storage::read_attractor_config(project_path)?;
    let manifest = storage::read_store_manifest(store_repo_path)?;

    if let (Some(cfg), Some(man)) = (config, manifest) {
        if cfg.store_id != man.store_id {
            return Err(AppError::StoreIdMismatch {
                expected: cfg.store_id,
                actual: man.store_id,
            });
        }
    }
    Ok(())
}

/// Resolve a unique backing repo name with auto-increment.
async fn resolve_backing_repo_name(token: &str, owner: &str, base_name: &str) -> Result<String, AppError> {
    if !github::repo_exists(token, owner, base_name).await? {
        return Ok(base_name.to_string());
    }
    for i in 1..100 {
        let candidate = format!("{}-{}", base_name, i);
        if !github::repo_exists(token, owner, &candidate).await? {
            return Ok(candidate);
        }
    }
    Err(AppError::General(format!(
        "Could not find an available repo name based on '{}'",
        base_name
    )))
}

/// Set up an existing GitHub repo as a backing store for a project.
/// Called after the user manually creates the repo on GitHub.
#[tauri::command]
pub async fn setup_backing_repo(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    owner: String,
    repo_name: String,
    project_path: String,
) -> Result<RecentProject, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let pp = std::path::PathBuf::from(&project_path);

    // Verify the repo actually exists on GitHub
    let exists = github::repo_exists(&token, &owner, &repo_name)
        .await
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err(format!(
            "Repository '{}/{}' not found on GitHub. Please create it first.",
            owner, repo_name
        ));
    }

    // Generate a unique store ID
    let store_id = Uuid::new_v4().to_string();

    // Clone and init backing store
    let backing_path = repo_path(&app_state, &owner, &repo_name);
    let clone_url = format!("https://github.com/{}/{}.git", owner, repo_name);
    let tok = token.clone();
    let login = user.login.clone();
    let sid = store_id.clone();

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::clone_or_open_repo(&clone_url, &backing_path, &tok)?;
        storage::sync_repo(&backing_path, &tok)?;
        if !backing_path.join(".attractor").exists() {
            storage::init_repo_structure(&backing_path)?;
        }
        // Write store manifest (even if .attractor/ already existed, we need the ID)
        if storage::read_store_manifest(&backing_path)?.is_none() {
            storage::write_store_manifest(&backing_path, &StoreManifest { store_id: sid })?;
            storage::commit_and_push(
                &backing_path,
                "Initialize attractor structure",
                &login,
                &author_email(&login),
                &tok,
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    // Read back the actual store_id (may have been pre-existing)
    let actual_store_id = {
        let bp = repo_path(&app_state, &owner, &repo_name);
        storage::read_store_manifest(&bp)
            .map_err(|e| e.to_string())?
            .map(|m| m.store_id)
            .unwrap_or(store_id)
    };

    // Write .amplifier/attractor.json in the project folder
    let config = AttractorConfig {
        owner: owner.clone(),
        repo: repo_name.clone(),
        store_id: actual_store_id,
    };
    storage::write_attractor_config(&pp, &config)
        .map_err(|e| e.to_string())?;

    // Track as current project
    {
        let mut guard = app_state.current_project_path.write().map_err(|e| format!("Lock error: {}", e))?;
        *guard = Some(project_path.clone());
    }

    let project = RecentProject {
        local_path: project_path,
        owner,
        repo: repo_name,
        last_opened: Utc::now(),
    };
    upsert_recent_project(&app, &project);

    Ok(project)
}

// ===================================================================
//  Issue commands
// ===================================================================

#[tauri::command]
pub async fn list_issues(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    state: Option<String>,
    labels: Option<String>,
    assignee: Option<String>,
    milestone: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<ListResponse<Issue>, String> {
    let path = repo_path(&app_state, &owner, &repo);
    let label_vec = labels.map(|s| s.split(',').map(|l| l.trim().to_string()).collect());

    let filters = IssueFilters {
        state,
        labels: label_vec,
        assignee,
        milestone,
        sort,
        direction,
        page,
        per_page,
    };

    let pg = filters.page.unwrap_or(1);
    let pp = filters.per_page.unwrap_or(30);

    let (items, total_count) = tokio::task::spawn_blocking(move || {
        storage::list_issues(&path, &filters)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(ListResponse {
        items,
        total_count,
        page: pg,
        per_page: pp,
    })
}

#[tauri::command]
pub async fn create_issue(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    title: String,
    body: Option<String>,
    assignees: Option<Vec<String>>,
    labels: Option<Vec<String>>,
    milestone: Option<u64>,
) -> Result<Issue, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Issue, AppError> {
        storage::sync_repo(&path, &token)?;

        let mut meta = storage::read_meta(&path)?;
        let issue_number = meta.next_issue_id;
        meta.next_issue_id += 1;

        let now = Utc::now();

        let assignee_users: Vec<SimpleUser> = assignees
            .unwrap_or_default()
            .into_iter()
            .map(|login| SimpleUser {
                login,
                id: 0,
                avatar_url: String::new(),
                user_type: "User".to_string(),
            })
            .collect();

        let all_labels = storage::read_labels(&path)?;
        let issue_labels: Vec<Label> = match labels {
            Some(names) => all_labels
                .into_iter()
                .filter(|l| names.contains(&l.name))
                .collect(),
            None => Vec::new(),
        };

        let issue_milestone = match milestone {
            Some(num) => {
                let ms = storage::read_milestones(&path)?;
                ms.into_iter().find(|m| m.number == num)
            }
            None => None,
        };

        let issue = Issue {
            id: issue_number,
            number: issue_number,
            title: title.clone(),
            body,
            state: "open".to_string(),
            state_reason: None,
            locked: false,
            lock_reason: None,
            labels: issue_labels,
            assignees: assignee_users,
            milestone: issue_milestone,
            comments: 0,
            created_at: now,
            updated_at: now,
            closed_at: None,
            closed_by: None,
            author_association: "OWNER".to_string(),
            user: user.clone(),
        };

        storage::write_issue(&path, &issue)?;
        storage::write_meta(&path, &meta)?;
        storage::commit_and_push(
            &path,
            &format!("Create issue #{}: {}", issue.number, title),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;

        Ok(issue)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_issue(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<Issue, String> {
    let path = repo_path(&app_state, &owner, &repo);
    tokio::task::spawn_blocking(move || storage::read_issue(&path, issue_number))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_issue(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    title: Option<String>,
    body: Option<String>,
    issue_state: Option<String>,
    state_reason: Option<String>,
    assignees: Option<Vec<String>>,
    labels: Option<Vec<String>>,
    milestone: Option<u64>,
) -> Result<Issue, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Issue, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        let now = Utc::now();

        if let Some(t) = title {
            issue.title = t;
        }
        if let Some(b) = body {
            issue.body = Some(b);
        }
        if let Some(s) = issue_state {
            if s == "closed" && issue.state != "closed" {
                issue.closed_at = Some(now);
                issue.closed_by = Some(user.clone());
            } else if s == "open" {
                issue.closed_at = None;
                issue.closed_by = None;
            }
            issue.state = s;
        }
        if let Some(sr) = state_reason {
            issue.state_reason = Some(sr);
        }
        if let Some(assignee_logins) = assignees {
            issue.assignees = assignee_logins
                .into_iter()
                .map(|login| SimpleUser {
                    login,
                    id: 0,
                    avatar_url: String::new(),
                    user_type: "User".to_string(),
                })
                .collect();
        }
        if let Some(label_names) = labels {
            let all_labels = storage::read_labels(&path)?;
            issue.labels = all_labels
                .into_iter()
                .filter(|l| label_names.contains(&l.name))
                .collect();
        }
        if let Some(ms_num) = milestone {
            let ms = storage::read_milestones(&path)?;
            issue.milestone = ms.into_iter().find(|m| m.number == ms_num);
        }

        issue.updated_at = now;
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Update issue #{}", issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(issue)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lock_issue(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    lock_reason: Option<String>,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        issue.locked = true;
        issue.lock_reason = lock_reason;
        issue.updated_at = Utc::now();
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Lock issue #{}", issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn unlock_issue(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        issue.locked = false;
        issue.lock_reason = None;
        issue.updated_at = Utc::now();
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Unlock issue #{}", issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ===================================================================
//  Comment commands
// ===================================================================

#[tauri::command]
pub async fn list_comments(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<ListResponse<Comment>, String> {
    let path = repo_path(&app_state, &owner, &repo);
    let pg = page.unwrap_or(1);
    let pp = per_page.unwrap_or(30);

    let (items, total_count) = tokio::task::spawn_blocking(move || {
        storage::list_comments_for_issue(&path, issue_number, pg, pp)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(ListResponse {
        items,
        total_count,
        page: pg,
        per_page: pp,
    })
}

#[tauri::command]
pub async fn create_comment(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    body: String,
) -> Result<Comment, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Comment, AppError> {
        storage::sync_repo(&path, &token)?;

        let mut meta = storage::read_meta(&path)?;
        let comment_id = meta.next_comment_id;
        meta.next_comment_id += 1;

        let now = Utc::now();
        let comment = Comment {
            id: comment_id,
            body,
            user: user.clone(),
            created_at: now,
            updated_at: now,
            author_association: "OWNER".to_string(),
        };

        storage::write_comment(&path, issue_number, &comment)?;
        storage::write_meta(&path, &meta)?;

        // Bump the comment count on the parent issue
        if let Ok(mut issue) = storage::read_issue(&path, issue_number) {
            issue.comments += 1;
            issue.updated_at = now;
            storage::write_issue(&path, &issue)?;
        }

        storage::commit_and_push(
            &path,
            &format!("Add comment #{} on issue #{}", comment_id, issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(comment)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_comment(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
) -> Result<Comment, String> {
    let path = repo_path(&app_state, &owner, &repo);
    tokio::task::spawn_blocking(move || {
        storage::find_comment(&path, comment_id).map(|(_, c)| c)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_comment(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
    body: String,
) -> Result<Comment, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Comment, AppError> {
        storage::sync_repo(&path, &token)?;
        let (issue_number, mut comment) = storage::find_comment(&path, comment_id)?;
        comment.body = body;
        comment.updated_at = Utc::now();
        storage::write_comment(&path, issue_number, &comment)?;
        storage::commit_and_push(
            &path,
            &format!("Update comment #{}", comment_id),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(comment)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_comment(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::sync_repo(&path, &token)?;
        let (issue_number, _) = storage::find_comment(&path, comment_id)?;
        storage::delete_comment_file(&path, issue_number, comment_id)?;

        // Decrement comment count
        if let Ok(mut issue) = storage::read_issue(&path, issue_number) {
            issue.comments = issue.comments.saturating_sub(1);
            issue.updated_at = Utc::now();
            storage::write_issue(&path, &issue)?;
        }

        storage::commit_and_push(
            &path,
            &format!("Delete comment #{}", comment_id),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ===================================================================
//  Label commands
// ===================================================================

fn next_label_id(labels: &[Label]) -> u64 {
    labels.iter().map(|l| l.id).max().unwrap_or(0) + 1
}

#[tauri::command]
pub async fn list_labels(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
) -> Result<Vec<Label>, String> {
    let path = repo_path(&app_state, &owner, &repo);
    tokio::task::spawn_blocking(move || storage::read_labels(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_label(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    name: String,
    color: String,
    description: Option<String>,
) -> Result<Label, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Label, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut labels = storage::read_labels(&path)?;

        if labels.iter().any(|l| l.name == name) {
            return Err(AppError::General(format!(
                "Label '{}' already exists",
                name
            )));
        }

        let label = Label {
            id: next_label_id(&labels),
            name: name.clone(),
            color,
            description,
            is_default: false,
        };
        labels.push(label.clone());
        storage::write_labels(&path, &labels)?;
        storage::commit_and_push(
            &path,
            &format!("Create label '{}'", name),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(label)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_label(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    name: String,
) -> Result<Label, String> {
    let path = repo_path(&app_state, &owner, &repo);
    tokio::task::spawn_blocking(move || -> Result<Label, AppError> {
        let labels = storage::read_labels(&path)?;
        labels
            .into_iter()
            .find(|l| l.name == name)
            .ok_or_else(|| AppError::NotFound(format!("Label '{}' not found", name)))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_label(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    name: String,
    new_name: Option<String>,
    color: Option<String>,
    description: Option<String>,
) -> Result<Label, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Label, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut labels = storage::read_labels(&path)?;
        let label = labels
            .iter_mut()
            .find(|l| l.name == name)
            .ok_or_else(|| AppError::NotFound(format!("Label '{}' not found", name)))?;

        if let Some(nn) = new_name {
            label.name = nn;
        }
        if let Some(c) = color {
            label.color = c;
        }
        if let Some(d) = description {
            label.description = Some(d);
        }

        let updated = label.clone();
        storage::write_labels(&path, &labels)?;
        storage::commit_and_push(
            &path,
            &format!("Update label '{}'", name),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(updated)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_label(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    name: String,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::sync_repo(&path, &token)?;
        let mut labels = storage::read_labels(&path)?;
        let before = labels.len();
        labels.retain(|l| l.name != name);
        if labels.len() == before {
            return Err(AppError::NotFound(format!("Label '{}' not found", name)));
        }
        storage::write_labels(&path, &labels)?;
        storage::commit_and_push(
            &path,
            &format!("Delete label '{}'", name),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// --- Issue-label associations ---

#[tauri::command]
pub async fn list_issue_labels(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<Vec<Label>, String> {
    let path = repo_path(&app_state, &owner, &repo);
    tokio::task::spawn_blocking(move || -> Result<Vec<Label>, AppError> {
        let issue = storage::read_issue(&path, issue_number)?;
        Ok(issue.labels)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_issue_labels(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    labels: Vec<String>,
) -> Result<Vec<Label>, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Vec<Label>, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        let all_labels = storage::read_labels(&path)?;

        for name in &labels {
            if !issue.labels.iter().any(|l| &l.name == name) {
                if let Some(label) = all_labels.iter().find(|l| &l.name == name) {
                    issue.labels.push(label.clone());
                }
            }
        }

        issue.updated_at = Utc::now();
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Add labels to issue #{}", issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(issue.labels)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_issue_labels(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    labels: Vec<String>,
) -> Result<Vec<Label>, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Vec<Label>, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        let all_labels = storage::read_labels(&path)?;

        issue.labels = all_labels
            .into_iter()
            .filter(|l| labels.contains(&l.name))
            .collect();

        issue.updated_at = Utc::now();
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Set labels on issue #{}", issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(issue.labels)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_all_issue_labels(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        issue.labels.clear();
        issue.updated_at = Utc::now();
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Remove all labels from issue #{}", issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_issue_label(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    issue_number: u64,
    name: String,
) -> Result<Vec<Label>, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Vec<Label>, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut issue = storage::read_issue(&path, issue_number)?;
        issue.labels.retain(|l| l.name != name);
        issue.updated_at = Utc::now();
        storage::write_issue(&path, &issue)?;
        storage::commit_and_push(
            &path,
            &format!("Remove label '{}' from issue #{}", name, issue_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(issue.labels)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ===================================================================
//  Milestone commands
// ===================================================================

#[tauri::command]
pub async fn list_milestones(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    state: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<Vec<Milestone>, String> {
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Vec<Milestone>, AppError> {
        let mut milestones = storage::read_milestones(&path)?;

        // Filter by state
        if let Some(ref st) = state {
            if st != "all" {
                milestones.retain(|m| m.state == *st);
            }
        } else {
            milestones.retain(|m| m.state == "open");
        }

        // Sort
        let sort_field = sort.as_deref().unwrap_or("due_on");
        let dir = direction.as_deref().unwrap_or("asc");
        milestones.sort_by(|a, b| {
            let ord = match sort_field {
                "completeness" => {
                    let a_total = a.open_issues + a.closed_issues;
                    let b_total = b.open_issues + b.closed_issues;
                    let a_pct = if a_total > 0 {
                        a.closed_issues * 100 / a_total
                    } else {
                        0
                    };
                    let b_pct = if b_total > 0 {
                        b.closed_issues * 100 / b_total
                    } else {
                        0
                    };
                    a_pct.cmp(&b_pct)
                }
                _ => a.due_on.cmp(&b.due_on), // "due_on" default
            };
            if dir == "desc" {
                ord.reverse()
            } else {
                ord
            }
        });

        // Paginate
        let pg = page.unwrap_or(1).max(1);
        let pp = per_page.unwrap_or(30).min(100);
        let start = ((pg - 1) * pp) as usize;
        let items: Vec<Milestone> = milestones
            .into_iter()
            .skip(start)
            .take(pp as usize)
            .collect();

        Ok(items)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_milestone(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    title: String,
    description: Option<String>,
    due_on: Option<String>,
    state: Option<String>,
) -> Result<Milestone, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Milestone, AppError> {
        storage::sync_repo(&path, &token)?;

        let mut meta = storage::read_meta(&path)?;
        let ms_number = meta.next_milestone_id;
        meta.next_milestone_id += 1;

        let now = Utc::now();
        let due = due_on.and_then(|s| s.parse::<chrono::DateTime<Utc>>().ok());

        let milestone = Milestone {
            id: ms_number,
            number: ms_number,
            title: title.clone(),
            description,
            state: state.unwrap_or_else(|| "open".to_string()),
            open_issues: 0,
            closed_issues: 0,
            created_at: now,
            updated_at: now,
            closed_at: None,
            due_on: due,
        };

        let mut milestones = storage::read_milestones(&path)?;
        milestones.push(milestone.clone());
        storage::write_milestones(&path, &milestones)?;
        storage::write_meta(&path, &meta)?;

        storage::commit_and_push(
            &path,
            &format!("Create milestone #{}: {}", ms_number, title),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(milestone)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_milestone(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    milestone_number: u64,
) -> Result<Milestone, String> {
    let path = repo_path(&app_state, &owner, &repo);
    tokio::task::spawn_blocking(move || -> Result<Milestone, AppError> {
        let milestones = storage::read_milestones(&path)?;
        milestones
            .into_iter()
            .find(|m| m.number == milestone_number)
            .ok_or_else(|| {
                AppError::NotFound(format!("Milestone #{} not found", milestone_number))
            })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_milestone(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    milestone_number: u64,
    title: Option<String>,
    description: Option<String>,
    due_on: Option<String>,
    milestone_state: Option<String>,
) -> Result<Milestone, String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<Milestone, AppError> {
        storage::sync_repo(&path, &token)?;
        let mut milestones = storage::read_milestones(&path)?;

        let ms = milestones
            .iter_mut()
            .find(|m| m.number == milestone_number)
            .ok_or_else(|| {
                AppError::NotFound(format!("Milestone #{} not found", milestone_number))
            })?;

        let now = Utc::now();
        if let Some(t) = title {
            ms.title = t;
        }
        if let Some(d) = description {
            ms.description = Some(d);
        }
        if let Some(d) = due_on {
            ms.due_on = d.parse::<chrono::DateTime<Utc>>().ok();
        }
        if let Some(s) = milestone_state {
            if s == "closed" && ms.state != "closed" {
                ms.closed_at = Some(now);
            } else if s == "open" {
                ms.closed_at = None;
            }
            ms.state = s;
        }
        ms.updated_at = now;

        let updated = ms.clone();
        storage::write_milestones(&path, &milestones)?;
        storage::commit_and_push(
            &path,
            &format!("Update milestone #{}", milestone_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(updated)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_milestone(
    app_state: State<'_, AppState>,
    owner: String,
    repo: String,
    milestone_number: u64,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let path = repo_path(&app_state, &owner, &repo);

    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        storage::sync_repo(&path, &token)?;
        let mut milestones = storage::read_milestones(&path)?;
        let before = milestones.len();
        milestones.retain(|m| m.number != milestone_number);
        if milestones.len() == before {
            return Err(AppError::NotFound(format!(
                "Milestone #{} not found",
                milestone_number
            )));
        }
        storage::write_milestones(&path, &milestones)?;
        storage::commit_and_push(
            &path,
            &format!("Delete milestone #{}", milestone_number),
            &user.login,
            &author_email(&user.login),
            &token,
        )?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ===================================================================
//  Amplifier commands
// ===================================================================

#[tauri::command]
pub async fn amplifier_run(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    manager: State<'_, AmplifierManager>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<(), String> {
    let token = require_token(&app_state)?;
    let user = require_user(&app_state)?;
    let store_repo_path = repo_path(&app_state, &owner, &repo);

    let project_path = app_state
        .current_project_path
        .read()
        .map_err(|e| format!("Lock error: {}", e))?
        .clone()
        .ok_or_else(|| "No project currently selected".to_string())?;

    let issue = storage::read_issue(&store_repo_path, issue_number)
        .map_err(|e| e.to_string())?;

    amplifier::spawn_session(
        app,
        manager,
        store_repo_path,
        token,
        user.login,
        owner,
        repo,
        issue,
        project_path,
    )
    .await
}

#[tauri::command]
pub async fn amplifier_status(
    manager: State<'_, AmplifierManager>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<Option<AmplifierSessionInfo>, String> {
    let key = amplifier::session_key(&owner, &repo, issue_number);
    let sessions = manager.sessions.read().await;
    Ok(sessions.get(&key).map(AmplifierSessionInfo::from))
}

#[tauri::command]
pub async fn amplifier_cancel(
    manager: State<'_, AmplifierManager>,
    owner: String,
    repo: String,
    issue_number: u64,
) -> Result<(), String> {
    let key = amplifier::session_key(&owner, &repo, issue_number);
    let sessions = manager.sessions.read().await;
    if let Some(session) = sessions.get(&key) {
        if let Some(pid) = session.child_id {
            // Send SIGTERM on Unix
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            // On Windows, use taskkill
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .spawn();
            }
            return Ok(());
        }
        return Err("Session has no active process".to_string());
    }
    Err(format!("No session found for issue #{}", issue_number))
}

// ---------------------------------------------------------------------------
// Shell openers (WSL-aware)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    if is_wsl() {
        let output = std::process::Command::new("wslpath")
            .arg("-w")
            .arg(&path)
            .output()
            .map_err(|e| format!("wslpath failed: {e}"))?;
        if !output.status.success() {
            return Err("Failed to convert WSL path to Windows path".to_string());
        }
        let win_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        std::process::Command::new("explorer.exe")
            .arg(&win_path)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {e}"))?;
    } else {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_in_vscode(path: String) -> Result<(), String> {
    std::process::Command::new("code")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open VS Code: {e}"))?;
    Ok(())
}
