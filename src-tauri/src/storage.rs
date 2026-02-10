use std::fs;
use std::path::{Path, PathBuf};

use git2::{
    build::CheckoutBuilder, Cred, FetchOptions, IndexAddOption, PushOptions, RemoteCallbacks,
    Repository, Signature,
};

use crate::error::AppError;
use crate::models::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn attractor_dir(repo_path: &Path) -> PathBuf {
    repo_path.join(".attractor")
}

fn make_fetch_options(token: &str) -> FetchOptions<'_> {
    let mut callbacks = RemoteCallbacks::new();
    let token = token.to_string();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token)
    });
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(callbacks);
    opts
}

// ---------------------------------------------------------------------------
// Repository management
// ---------------------------------------------------------------------------

/// Clone a remote repository into `path`, authenticating with `token`.
pub fn clone_repo(url: &str, path: &Path, token: &str) -> Result<Repository, AppError> {
    let fetch_opts = make_fetch_options(token);
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_opts);
    let repo = builder.clone(url, path)?;
    Ok(repo)
}

/// Open an existing local repository, or clone it if it doesn't exist yet.
pub fn clone_or_open_repo(url: &str, path: &Path, token: &str) -> Result<Repository, AppError> {
    if path.join(".git").exists() {
        Ok(Repository::open(path)?)
    } else {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        clone_repo(url, path, token)
    }
}

/// Fetch from origin and fast-forward the current branch.
pub fn sync_repo(path: &Path, token: &str) -> Result<(), AppError> {
    let repo = Repository::open(path)?;

    // Fetch all branches from origin
    let mut remote = repo.find_remote("origin")?;
    let mut fetch_opts = make_fetch_options(token);
    remote.fetch(
        &["refs/heads/*:refs/remotes/origin/*"],
        Some(&mut fetch_opts),
        None,
    )?;
    drop(remote);

    // Determine current branch
    let head = match repo.head() {
        Ok(h) => h,
        Err(_) => return Ok(()), // empty repo – nothing to sync
    };
    let branch_name = head.shorthand().unwrap_or("main").to_string();

    // Find the corresponding remote-tracking ref
    let remote_ref_name = format!("refs/remotes/origin/{}", branch_name);
    let remote_ref = match repo.find_reference(&remote_ref_name) {
        Ok(r) => r,
        Err(_) => return Ok(()), // no remote tracking branch yet
    };
    let remote_commit = repo.reference_to_annotated_commit(&remote_ref)?;

    // Merge analysis
    let (analysis, _) = repo.merge_analysis(&[&remote_commit])?;

    if analysis.is_up_to_date() {
        // nothing to do
    } else if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{}", branch_name);
        let mut reference = repo.find_reference(&refname)?;
        reference.set_target(remote_commit.id(), "Fast-forward pull")?;
        repo.set_head(&refname)?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))?;
    } else {
        return Err(AppError::Storage(
            "Merge required – please resolve conflicts manually".to_string(),
        ));
    }

    Ok(())
}

/// Create the `.attractor/` directory structure with seed files.
pub fn init_repo_structure(repo_path: &Path) -> Result<(), AppError> {
    let base = attractor_dir(repo_path);
    fs::create_dir_all(base.join("issues"))?;
    fs::create_dir_all(base.join("comments"))?;

    // Seed files (only if they don't already exist)
    let labels_path = base.join("labels.json");
    if !labels_path.exists() {
        fs::write(&labels_path, "[]")?;
    }

    let milestones_path = base.join("milestones.json");
    if !milestones_path.exists() {
        fs::write(&milestones_path, "[]")?;
    }

    let meta_path = base.join("meta.json");
    if !meta_path.exists() {
        let meta = Meta::default();
        fs::write(&meta_path, serde_json::to_string_pretty(&meta)?)?;
    }

    // .gitkeep so git tracks empty directories
    let issues_keep = base.join("issues/.gitkeep");
    if !issues_keep.exists() {
        fs::write(&issues_keep, "")?;
    }
    let comments_keep = base.join("comments/.gitkeep");
    if !comments_keep.exists() {
        fs::write(&comments_keep, "")?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Git commit & push
// ---------------------------------------------------------------------------

/// Stage everything under `.attractor/` and `attractor-store.json`, commit, and push to origin.
pub fn commit_and_push(
    repo_path: &Path,
    message: &str,
    author_name: &str,
    author_email: &str,
    token: &str,
) -> Result<(), AppError> {
    let repo = Repository::open(repo_path)?;
    let mut index = repo.index()?;

    // Stage new + modified files (data dir + store manifest at root)
    index.add_all(
        [".attractor", "attractor-store.json"].iter(),
        IndexAddOption::DEFAULT,
        None,
    )?;
    // Remove index entries for files deleted from disk
    index.update_all([".attractor"].iter(), None)?;
    index.write()?;

    // Build tree
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    // Parent commit (may not exist for first commit)
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(_) => None,
    };

    // Skip if tree unchanged
    if let Some(ref p) = parent {
        if p.tree_id() == tree_id {
            return Ok(());
        }
    }

    let sig = Signature::now(author_name, author_email)?;

    match parent {
        Some(ref pc) => {
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[pc])?;
        }
        None => {
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])?;
        }
    };

    // Push
    let mut remote = repo.find_remote("origin")?;
    let mut callbacks = RemoteCallbacks::new();
    let tok = token.to_string();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &tok)
    });
    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    let head = repo.head()?;
    let branch = head.shorthand().unwrap_or("main");
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    remote.push(&[&refspec], Some(&mut push_opts))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Meta operations
// ---------------------------------------------------------------------------

pub fn read_meta(repo_path: &Path) -> Result<Meta, AppError> {
    let file = attractor_dir(repo_path).join("meta.json");
    if !file.exists() {
        return Ok(Meta::default());
    }
    let content = fs::read_to_string(&file)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_meta(repo_path: &Path, meta: &Meta) -> Result<(), AppError> {
    let file = attractor_dir(repo_path).join("meta.json");
    fs::write(&file, serde_json::to_string_pretty(meta)?)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Issue operations
// ---------------------------------------------------------------------------

pub fn read_issue(repo_path: &Path, issue_number: u64) -> Result<Issue, AppError> {
    let file = attractor_dir(repo_path).join(format!("issues/{}.json", issue_number));
    if !file.exists() {
        return Err(AppError::NotFound(format!(
            "Issue #{} not found",
            issue_number
        )));
    }
    let content = fs::read_to_string(&file)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_issue(repo_path: &Path, issue: &Issue) -> Result<(), AppError> {
    let dir = attractor_dir(repo_path).join("issues");
    fs::create_dir_all(&dir)?;
    let file = dir.join(format!("{}.json", issue.number));
    fs::write(&file, serde_json::to_string_pretty(issue)?)?;
    Ok(())
}

fn list_all_issues(repo_path: &Path) -> Result<Vec<Issue>, AppError> {
    let dir = attractor_dir(repo_path).join("issues");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut issues = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let content = fs::read_to_string(&path)?;
            let issue: Issue = serde_json::from_str(&content)?;
            issues.push(issue);
        }
    }
    Ok(issues)
}

/// List issues with filtering, sorting, and pagination.
pub fn list_issues(
    repo_path: &Path,
    filters: &IssueFilters,
) -> Result<(Vec<Issue>, usize), AppError> {
    let mut issues = list_all_issues(repo_path)?;

    // Filter by state (default: open)
    if let Some(ref st) = filters.state {
        if st != "all" {
            issues.retain(|i| i.state == *st);
        }
    } else {
        issues.retain(|i| i.state == "open");
    }

    // Filter by labels (all must match)
    if let Some(ref label_names) = filters.labels {
        if !label_names.is_empty() {
            issues.retain(|i| {
                label_names
                    .iter()
                    .all(|name| i.labels.iter().any(|l| l.name == *name))
            });
        }
    }

    // Filter by assignee
    if let Some(ref assignee) = filters.assignee {
        if assignee == "none" {
            issues.retain(|i| i.assignees.is_empty());
        } else if assignee != "*" {
            issues.retain(|i| i.assignees.iter().any(|a| a.login == *assignee));
        }
    }

    // Filter by milestone
    if let Some(ref ms) = filters.milestone {
        if ms == "none" {
            issues.retain(|i| i.milestone.is_none());
        } else if ms == "*" {
            issues.retain(|i| i.milestone.is_some());
        } else if let Ok(number) = ms.parse::<u64>() {
            issues.retain(|i| {
                i.milestone
                    .as_ref()
                    .map_or(false, |m| m.number == number)
            });
        }
    }

    // Sort
    let sort_field = filters.sort.as_deref().unwrap_or("created");
    let direction = filters.direction.as_deref().unwrap_or("desc");

    issues.sort_by(|a, b| {
        let ord = match sort_field {
            "updated" => a.updated_at.cmp(&b.updated_at),
            "comments" => a.comments.cmp(&b.comments),
            _ => a.created_at.cmp(&b.created_at),
        };
        if direction == "asc" {
            ord
        } else {
            ord.reverse()
        }
    });

    let total_count = issues.len();

    // Paginate
    let page = filters.page.unwrap_or(1).max(1);
    let per_page = filters.per_page.unwrap_or(30).min(100);
    let start = ((page - 1) * per_page) as usize;
    let items: Vec<Issue> = issues.into_iter().skip(start).take(per_page as usize).collect();

    Ok((items, total_count))
}

// ---------------------------------------------------------------------------
// Comment operations
// ---------------------------------------------------------------------------

#[allow(dead_code)]
pub fn read_comment(
    repo_path: &Path,
    issue_number: u64,
    comment_id: u64,
) -> Result<Comment, AppError> {
    let file = attractor_dir(repo_path).join(format!(
        "comments/{}/{}.json",
        issue_number, comment_id
    ));
    if !file.exists() {
        return Err(AppError::NotFound(format!(
            "Comment #{} not found",
            comment_id
        )));
    }
    let content = fs::read_to_string(&file)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_comment(
    repo_path: &Path,
    issue_number: u64,
    comment: &Comment,
) -> Result<(), AppError> {
    let dir = attractor_dir(repo_path).join(format!("comments/{}", issue_number));
    fs::create_dir_all(&dir)?;
    let file = dir.join(format!("{}.json", comment.id));
    fs::write(&file, serde_json::to_string_pretty(comment)?)?;
    Ok(())
}

pub fn list_comments_for_issue(
    repo_path: &Path,
    issue_number: u64,
    page: u32,
    per_page: u32,
) -> Result<(Vec<Comment>, usize), AppError> {
    let dir = attractor_dir(repo_path).join(format!("comments/{}", issue_number));
    if !dir.exists() {
        return Ok((Vec::new(), 0));
    }

    let mut comments = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let content = fs::read_to_string(&path)?;
            let comment: Comment = serde_json::from_str(&content)?;
            comments.push(comment);
        }
    }

    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    let total_count = comments.len();
    let page = page.max(1);
    let per_page = per_page.min(100);
    let start = ((page - 1) * per_page) as usize;
    let items: Vec<Comment> = comments
        .into_iter()
        .skip(start)
        .take(per_page as usize)
        .collect();

    Ok((items, total_count))
}

pub fn delete_comment_file(
    repo_path: &Path,
    issue_number: u64,
    comment_id: u64,
) -> Result<(), AppError> {
    let file = attractor_dir(repo_path).join(format!(
        "comments/{}/{}.json",
        issue_number, comment_id
    ));
    if file.exists() {
        fs::remove_file(&file)?;
    }
    Ok(())
}

/// Search all issue-comment directories for a comment with the given id.
/// Returns `(issue_number, Comment)`.
pub fn find_comment(repo_path: &Path, comment_id: u64) -> Result<(u64, Comment), AppError> {
    let comments_root = attractor_dir(repo_path).join("comments");
    if !comments_root.exists() {
        return Err(AppError::NotFound(format!(
            "Comment #{} not found",
            comment_id
        )));
    }

    for entry in fs::read_dir(&comments_root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let issue_number: u64 = match entry.file_name().to_string_lossy().parse() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let file = entry.path().join(format!("{}.json", comment_id));
        if file.exists() {
            let content = fs::read_to_string(&file)?;
            let comment: Comment = serde_json::from_str(&content)?;
            return Ok((issue_number, comment));
        }
    }

    Err(AppError::NotFound(format!(
        "Comment #{} not found",
        comment_id
    )))
}

// ---------------------------------------------------------------------------
// Label operations
// ---------------------------------------------------------------------------

pub fn read_labels(repo_path: &Path) -> Result<Vec<Label>, AppError> {
    let file = attractor_dir(repo_path).join("labels.json");
    if !file.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&file)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_labels(repo_path: &Path, labels: &[Label]) -> Result<(), AppError> {
    let file = attractor_dir(repo_path).join("labels.json");
    fs::write(&file, serde_json::to_string_pretty(labels)?)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Milestone operations
// ---------------------------------------------------------------------------

pub fn read_milestones(repo_path: &Path) -> Result<Vec<Milestone>, AppError> {
    let file = attractor_dir(repo_path).join("milestones.json");
    if !file.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&file)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_milestones(repo_path: &Path, milestones: &[Milestone]) -> Result<(), AppError> {
    let file = attractor_dir(repo_path).join("milestones.json");
    fs::write(&file, serde_json::to_string_pretty(milestones)?)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Store manifest operations (root of backing-store repo)
// ---------------------------------------------------------------------------

/// Read the store manifest from the root of a backing-store repo.
pub fn read_store_manifest(repo_path: &Path) -> Result<Option<StoreManifest>, AppError> {
    let manifest_path = repo_path.join("attractor-store.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&manifest_path)?;
    let manifest: StoreManifest = serde_json::from_str(&content)?;
    Ok(Some(manifest))
}

/// Write the store manifest to the root of a backing-store repo.
pub fn write_store_manifest(repo_path: &Path, manifest: &StoreManifest) -> Result<(), AppError> {
    let file = repo_path.join("attractor-store.json");
    fs::write(&file, serde_json::to_string_pretty(manifest)?)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// .amplifier/ project config operations
// ---------------------------------------------------------------------------

/// Read the attractor config from a project folder's .amplifier/attractor.json.
pub fn read_attractor_config(project_path: &Path) -> Result<Option<AttractorConfig>, AppError> {
    let config_path = project_path.join(".amplifier").join("attractor.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&config_path)?;
    let config: AttractorConfig = serde_json::from_str(&content)?;
    Ok(Some(config))
}

/// Write the attractor config to a project folder's .amplifier/attractor.json.
pub fn write_attractor_config(project_path: &Path, config: &AttractorConfig) -> Result<(), AppError> {
    let dir = project_path.join(".amplifier");
    fs::create_dir_all(&dir)?;
    let file = dir.join("attractor.json");
    fs::write(&file, serde_json::to_string_pretty(config)?)?;
    Ok(())
}
