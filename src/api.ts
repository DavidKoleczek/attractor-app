import { invoke } from "@tauri-apps/api/core";
import type {
  SimpleUser,
  Label,
  Milestone,
  Issue,
  Comment,
  RepoInfo,
  RecentProject,
  ListResponse,
} from "@/types";

// Tauri invoke automatically converts camelCase JS param keys to snake_case for Rust.
// All commands return Result<T, String> on the Rust side; errors are thrown as strings.

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────
  setToken: (token: string) => invoke<SimpleUser>("set_token", { token }),

  getToken: () => invoke<string | null>("get_token"),

  validateToken: (token: string) =>
    invoke<SimpleUser>("validate_token", { token }),

  // ── Projects ─────────────────────────────────────────────────────────
  listProjects: (prefix: string) =>
    invoke<RepoInfo[]>("list_projects", { prefix }),

  createProject: (name: string, description: string, isPrivate: boolean = true) =>
    invoke<RepoInfo>("create_project", { name, description, private: isPrivate }),

  selectProject: (owner: string, repo: string) =>
    invoke<void>("select_project", { owner, repo }),

  // ── New Project flows ─────────────────────────────────────────────────
  listRecentProjects: () =>
    invoke<RecentProject[]>("list_recent_projects"),

  removeRecentProject: (localPath: string) =>
    invoke<void>("remove_recent_project", { localPath }),

  createLocalProject: (parentPath: string, folderName: string) =>
    invoke<RecentProject>("create_local_project", { parentPath, folderName }),

  createGithubProject: (
    repoName: string,
    description: string,
    isPrivate: boolean,
    parentPath: string,
  ) =>
    invoke<RecentProject>("create_github_project", {
      repoName,
      description,
      isPrivate,
      parentPath,
    }),

  openLocalProject: (folderPath: string) =>
    invoke<RecentProject>("open_local_project", { folderPath }),

  openGithubProject: (owner: string, repo: string, parentPath: string) =>
    invoke<RecentProject>("open_github_project", { owner, repo, parentPath }),

  setupBackingRepo: (owner: string, repoName: string, projectPath: string) =>
    invoke<RecentProject>("setup_backing_repo", { owner, repoName, projectPath }),

  // ── Issues ───────────────────────────────────────────────────────────
  listIssues: (
    owner: string,
    repo: string,
    params?: {
      state?: string;
      labels?: string;
      assignee?: string;
      milestone?: string;
      sort?: string;
      direction?: string;
      page?: number;
      perPage?: number;
    },
  ) =>
    invoke<ListResponse<Issue>>("list_issues", {
      owner,
      repo,
      ...params,
    }),

  createIssue: (
    owner: string,
    repo: string,
    data: {
      title: string;
      body?: string;
      assignees?: string[];
      labels?: string[];
      milestone?: number;
    },
  ) =>
    invoke<Issue>("create_issue", {
      owner,
      repo,
      ...data,
    }),

  getIssue: (owner: string, repo: string, issueNumber: number) =>
    invoke<Issue>("get_issue", { owner, repo, issueNumber }),

  updateIssue: (
    owner: string,
    repo: string,
    issueNumber: number,
    data: {
      title?: string;
      body?: string;
      issueState?: string;
      stateReason?: string;
      assignees?: string[];
      labels?: string[];
      milestone?: number;
    },
  ) =>
    invoke<Issue>("update_issue", {
      owner,
      repo,
      issueNumber,
      ...data,
    }),

  lockIssue: (
    owner: string,
    repo: string,
    issueNumber: number,
    lockReason?: string,
  ) => invoke<void>("lock_issue", { owner, repo, issueNumber, lockReason }),

  unlockIssue: (owner: string, repo: string, issueNumber: number) =>
    invoke<void>("unlock_issue", { owner, repo, issueNumber }),

  // ── Comments ─────────────────────────────────────────────────────────
  listComments: (
    owner: string,
    repo: string,
    issueNumber: number,
    params?: { page?: number; perPage?: number },
  ) =>
    invoke<ListResponse<Comment>>("list_comments", {
      owner,
      repo,
      issueNumber,
      ...params,
    }),

  createComment: (
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ) => invoke<Comment>("create_comment", { owner, repo, issueNumber, body }),

  getComment: (owner: string, repo: string, commentId: number) =>
    invoke<Comment>("get_comment", { owner, repo, commentId }),

  updateComment: (
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ) => invoke<Comment>("update_comment", { owner, repo, commentId, body }),

  deleteComment: (owner: string, repo: string, commentId: number) =>
    invoke<void>("delete_comment", { owner, repo, commentId }),

  // ── Labels ───────────────────────────────────────────────────────────
  listLabels: (owner: string, repo: string) =>
    invoke<Label[]>("list_labels", { owner, repo }),

  createLabel: (
    owner: string,
    repo: string,
    name: string,
    color: string,
    description?: string,
  ) => invoke<Label>("create_label", { owner, repo, name, color, description }),

  getLabel: (owner: string, repo: string, name: string) =>
    invoke<Label>("get_label", { owner, repo, name }),

  updateLabel: (
    owner: string,
    repo: string,
    name: string,
    data: { newName?: string; color?: string; description?: string },
  ) => invoke<Label>("update_label", { owner, repo, name, ...data }),

  deleteLabel: (owner: string, repo: string, name: string) =>
    invoke<void>("delete_label", { owner, repo, name }),

  listIssueLabels: (owner: string, repo: string, issueNumber: number) =>
    invoke<Label[]>("list_issue_labels", { owner, repo, issueNumber }),

  addIssueLabels: (
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
  ) => invoke<Label[]>("add_issue_labels", { owner, repo, issueNumber, labels }),

  setIssueLabels: (
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
  ) => invoke<Label[]>("set_issue_labels", { owner, repo, issueNumber, labels }),

  removeAllIssueLabels: (owner: string, repo: string, issueNumber: number) =>
    invoke<void>("remove_all_issue_labels", { owner, repo, issueNumber }),

  removeIssueLabel: (
    owner: string,
    repo: string,
    issueNumber: number,
    name: string,
  ) =>
    invoke<Label[]>("remove_issue_label", {
      owner,
      repo,
      issueNumber,
      name,
    }),

  // ── Milestones ───────────────────────────────────────────────────────
  listMilestones: (
    owner: string,
    repo: string,
    params?: {
      state?: string;
      sort?: string;
      direction?: string;
      page?: number;
      perPage?: number;
    },
  ) => invoke<Milestone[]>("list_milestones", { owner, repo, ...params }),

  createMilestone: (
    owner: string,
    repo: string,
    data: {
      title: string;
      description?: string;
      dueOn?: string;
      state?: string;
    },
  ) => invoke<Milestone>("create_milestone", { owner, repo, ...data }),

  getMilestone: (owner: string, repo: string, milestoneNumber: number) =>
    invoke<Milestone>("get_milestone", { owner, repo, milestoneNumber }),

  updateMilestone: (
    owner: string,
    repo: string,
    milestoneNumber: number,
    data: {
      title?: string;
      description?: string;
      dueOn?: string;
      milestoneState?: string;
    },
  ) =>
    invoke<Milestone>("update_milestone", {
      owner,
      repo,
      milestoneNumber,
      ...data,
    }),

  deleteMilestone: (owner: string, repo: string, milestoneNumber: number) =>
    invoke<void>("delete_milestone", { owner, repo, milestoneNumber }),
};
