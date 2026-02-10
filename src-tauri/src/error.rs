use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Git error: {0}")]
    Git(#[from] git2::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("{0}")]
    General(String),

    /// GitHub API returned 403 when trying to create a repository.
    /// The token likely lacks Administration (write) permission.
    #[error("REPO_CREATE_FORBIDDEN:{0}")]
    RepoCreationForbidden(String),

    /// The store_id in the project config doesn't match the backing store manifest.
    #[error("Store ID mismatch: project expects '{expected}' but store has '{actual}'. This backing store belongs to a different project.")]
    StoreIdMismatch { expected: String, actual: String },
}

impl From<AppError> for String {
    fn from(err: AppError) -> String {
        err.to_string()
    }
}
