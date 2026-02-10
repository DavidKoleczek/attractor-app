// Types matching the Rust backend models exactly.
// Serde renames: SimpleUser.user_type -> "type", Label.is_default -> "default"

export interface SimpleUser {
  login: string;
  id: number;
  avatar_url: string;
  type: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  description: string | null;
  default: boolean;
}

export interface Milestone {
  id: number;
  number: number;
  title: string;
  description: string | null;
  state: string;
  open_issues: number;
  closed_issues: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  due_on: string | null;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason: string | null;
  locked: boolean;
  lock_reason: string | null;
  labels: Label[];
  assignees: SimpleUser[];
  milestone: Milestone | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: SimpleUser | null;
  author_association: string;
  user: SimpleUser;
}

export interface Comment {
  id: number;
  body: string;
  user: SimpleUser;
  created_at: string;
  updated_at: string;
  author_association: string;
}

export interface RepoInfo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  owner: SimpleUser;
}

export interface ListResponse<T> {
  items: T[];
  total_count: number;
  page: number;
  per_page: number;
}

export interface Meta {
  next_issue_id: number;
  next_comment_id: number;
  next_milestone_id: number;
}

export interface AttractorConfig {
  owner: string;
  repo: string;
  store_id: string;
}

export interface RecentProject {
  local_path: string;
  owner: string;
  repo: string;
  last_opened: string;
}

export interface RepoCreateForbiddenInfo {
  owner: string;
  repo_name: string;
  project_path: string;
}
