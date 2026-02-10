use std::path::PathBuf;
use std::sync::RwLock;

use crate::models::{RepoInfo, SimpleUser};

pub struct AppState {
    pub token: RwLock<Option<String>>,
    pub user: RwLock<Option<SimpleUser>>,
    pub current_repo: RwLock<Option<RepoInfo>>,
    pub current_project_path: RwLock<Option<String>>,
    pub repos_dir: PathBuf,
}

impl AppState {
    pub fn new(repos_dir: PathBuf) -> Self {
        Self {
            token: RwLock::new(None),
            user: RwLock::new(None),
            current_repo: RwLock::new(None),
            current_project_path: RwLock::new(None),
            repos_dir,
        }
    }
}
