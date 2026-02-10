use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::Client;

use crate::error::AppError;
use crate::models::{RepoInfo, SimpleUser};

const GITHUB_API_URL: &str = "https://api.github.com";

fn build_client(token: &str) -> Result<Client, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token))
            .map_err(|e| AppError::General(e.to_string()))?,
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("attractor-issues-app"),
    );
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static("2022-11-28"),
    );

    Client::builder()
        .default_headers(headers)
        .build()
        .map_err(AppError::Http)
}

/// Validate a PAT and return the authenticated user.
pub async fn get_authenticated_user(token: &str) -> Result<SimpleUser, AppError> {
    let client = build_client(token)?;
    let resp = client
        .get(format!("{}/user", GITHUB_API_URL))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    let user: SimpleUser = resp.json().await?;
    Ok(user)
}

/// List repositories owned by the authenticated user whose name starts with `prefix`.
pub async fn list_repos(token: &str, prefix: &str) -> Result<Vec<RepoInfo>, AppError> {
    let client = build_client(token)?;
    let mut all_repos = Vec::new();
    let mut page = 1u32;

    loop {
        let resp = client
            .get(format!("{}/user/repos", GITHUB_API_URL))
            .query(&[
                ("per_page", "100"),
                ("page", &page.to_string()),
                ("sort", "updated"),
                ("affiliation", "owner"),
            ])
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::General(format!(
                "GitHub API error {}: {}",
                status, body
            )));
        }

        let repos: Vec<RepoInfo> = resp.json().await?;
        let count = repos.len();

        for repo in repos {
            if repo.name.starts_with(prefix) {
                all_repos.push(repo);
            }
        }

        if count < 100 {
            break;
        }
        page += 1;
    }

    Ok(all_repos)
}

#[derive(serde::Serialize)]
struct CreateRepoRequest {
    name: String,
    description: String,
    private: bool,
    auto_init: bool,
}

/// Create a new GitHub repository.
pub async fn create_repo(
    token: &str,
    name: &str,
    description: &str,
    private: bool,
) -> Result<RepoInfo, AppError> {
    let client = build_client(token)?;
    let body = CreateRepoRequest {
        name: name.to_string(),
        description: description.to_string(),
        private,
        auto_init: true,
    };

    let resp = client
        .post(format!("{}/user/repos", GITHUB_API_URL))
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // Detect 403 (token lacks Administration permission for repo creation)
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::RepoCreationForbidden(name.to_string()));
        }
        return Err(AppError::General(format!(
            "GitHub API error {}: {}",
            status, body
        )));
    }

    let repo: RepoInfo = resp.json().await?;
    Ok(repo)
}

/// Check whether a repository exists for the authenticated user.
pub async fn repo_exists(token: &str, owner: &str, repo: &str) -> Result<bool, AppError> {
    let client = build_client(token)?;
    let resp = client
        .get(format!("{}/repos/{}/{}", GITHUB_API_URL, owner, repo))
        .send()
        .await?;
    Ok(resp.status().is_success())
}
