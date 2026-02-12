export interface SimpleUser {
  login: string
  id: number
  avatar_url: string
  type: string
}

export interface Label {
  id: number
  name: string
  color: string
  description: string | null
  default: boolean
}

export interface Issue {
  id: number
  number: number
  title: string
  body: string | null
  state: "open" | "closed"
  state_reason: string | null
  labels: Label[]
  assignees: SimpleUser[]
  comments: number
  created_at: string
  updated_at: string
  closed_at: string | null
  closed_by: SimpleUser | null
  author_association: string
  user: SimpleUser
}

export interface Comment {
  id: number
  body: string
  user: SimpleUser
  created_at: string
  updated_at: string
  author_association: string
}

export interface ListResponse<T> {
  items: T[]
  total_count: number
  page: number
  per_page: number
}

export interface AmplifierSessionInfo {
  issueNumber: number
  status: "running" | "completed" | "failed"
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface GitHubStoreConfig {
  owner: string
  repo: string
  remote_url: string
}

export interface StoreConfig {
  path: string
  github: GitHubStoreConfig | null
}

export interface GitHubStatus {
  configured: boolean
  user: string | null
  validated_at: string | null
}

export interface StoreStatus {
  store_id: string
  path: string
  github: GitHubStoreConfig | null
}

export interface SyncResult {
  pulled: boolean
  pushed: boolean
}

export interface PatUrl {
  url: string
  required_permissions: string[]
}

export interface AppConfig {
  pat_banner_dismissed: boolean
  recent_projects: string[]
}

export interface PathValidationResponse {
  path: string
  status:
    | "not_found"
    | "empty"
    | "has_content"
    | "git_repo"
    | "already_registered"
    | "not_a_directory"
    | "permission_denied"
  project_name: string | null
  suggested_name: string | null
}

export interface GitHubRepo {
  full_name: string
  name: string
  owner: string
  description: string | null
  private: boolean
  html_url: string
}

export interface CreateProjectRequest {
  name: string
  mode: "empty" | "folder" | "github"
  path?: string
  owner?: string
  repo?: string
}
