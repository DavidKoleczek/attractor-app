use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// --- Core GitHub-compatible types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimpleUser {
    pub login: String,
    pub id: u64,
    pub avatar_url: String,
    #[serde(rename = "type")]
    pub user_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: u64,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
    #[serde(rename = "default")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub state_reason: Option<String>,
    pub labels: Vec<Label>,
    pub assignees: Vec<SimpleUser>,
    pub comments: u64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    pub closed_by: Option<SimpleUser>,
    pub author_association: String,
    pub user: SimpleUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: u64,
    pub body: String,
    pub user: SimpleUser,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub author_association: String,
}

// --- Storage metadata ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub next_issue_id: u64,
    pub next_comment_id: u64,
}

impl Default for Meta {
    fn default() -> Self {
        Self {
            next_issue_id: 1,
            next_comment_id: 1,
        }
    }
}

// --- GitHub API response types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub description: Option<String>,
    pub private: bool,
    pub html_url: String,
    pub clone_url: String,
    pub owner: SimpleUser,
}

// --- Generic list response for paginated results ---

#[derive(Debug, Clone, Serialize)]
pub struct ListResponse<T> {
    pub items: Vec<T>,
    pub total_count: usize,
    pub page: u32,
    pub per_page: u32,
}

// --- Filter types ---

#[derive(Debug, Clone, Default)]
pub struct IssueFilters {
    pub state: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub sort: Option<String>,
    pub direction: Option<String>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

// --- Attractor project config ---

/// Config stored in .amplifier/attractor.json inside a project folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttractorConfig {
    pub owner: String,
    pub repo: String,
    /// Unique ID linking this project to its backing store.
    pub store_id: String,
}

/// Manifest stored at the root of a backing-store repo as `attractor-store.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreManifest {
    /// Must match the `store_id` in the project's AttractorConfig.
    pub store_id: String,
}

/// A recently-used project tracked by the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub local_path: String,
    pub owner: String,
    pub repo: String,
    pub last_opened: DateTime<Utc>,
}
