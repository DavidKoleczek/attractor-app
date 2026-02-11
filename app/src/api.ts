import type {
  Issue,
  Comment,
  Label,
  ListResponse,
  AmplifierSessionInfo,
} from "@/types"

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

function json(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

export interface ProjectInfo {
  name: string
  path: string
  issues_path: string
}

export interface IssueFilters {
  state?: string
  labels?: string
  assignee?: string
  sort?: string
  direction?: string
  page?: number
  per_page?: number
}

export interface CreateIssuePayload {
  title: string
  body?: string
  labels?: string[]
}

export interface UpdateIssuePayload {
  title?: string
  body?: string
  state?: string
  state_reason?: string
  labels?: string[]
}

export interface CreateLabelPayload {
  name: string
  color: string
  description?: string
}

export interface UpdateLabelPayload {
  new_name?: string
  color?: string
  description?: string
}

export const api = {
  // -- Projects --
  listProjects(): Promise<ProjectInfo[]> {
    return request("/api/projects")
  },
  getProject(name: string): Promise<ProjectInfo> {
    return request(`/api/projects/${enc(name)}`)
  },
  createProject(name: string): Promise<ProjectInfo> {
    return request("/api/projects", { method: "POST", ...json({ name }) })
  },
  deleteProject(name: string): Promise<void> {
    return request(`/api/projects/${enc(name)}`, { method: "DELETE" })
  },

  // -- Issues --
  listIssues(
    project: string,
    filters?: IssueFilters,
  ): Promise<ListResponse<Issue>> {
    const q = filters
      ? qs({
          state: filters.state,
          labels: filters.labels,
          assignee: filters.assignee,
          sort: filters.sort,
          direction: filters.direction,
          page: filters.page,
          per_page: filters.per_page,
        })
      : ""
    return request(`/api/projects/${enc(project)}/issues${q}`)
  },
  createIssue(
    project: string,
    payload: CreateIssuePayload,
  ): Promise<Issue> {
    return request(`/api/projects/${enc(project)}/issues`, {
      method: "POST",
      ...json(payload),
    })
  },
  getIssue(project: string, number: number): Promise<Issue> {
    return request(`/api/projects/${enc(project)}/issues/${number}`)
  },
  updateIssue(
    project: string,
    number: number,
    fields: UpdateIssuePayload,
  ): Promise<Issue> {
    return request(`/api/projects/${enc(project)}/issues/${number}`, {
      method: "PATCH",
      ...json(fields),
    })
  },

  // -- Comments --
  listComments(
    project: string,
    issueNumber: number,
    page?: number,
    perPage?: number,
  ): Promise<ListResponse<Comment>> {
    const q = qs({ page, per_page: perPage })
    return request(
      `/api/projects/${enc(project)}/issues/${issueNumber}/comments${q}`,
    )
  },
  createComment(
    project: string,
    issueNumber: number,
    body: string,
  ): Promise<Comment> {
    return request(
      `/api/projects/${enc(project)}/issues/${issueNumber}/comments`,
      { method: "POST", ...json({ body }) },
    )
  },
  updateComment(
    project: string,
    commentId: number,
    body: string,
  ): Promise<Comment> {
    return request(`/api/projects/${enc(project)}/comments/${commentId}`, {
      method: "PATCH",
      ...json({ body }),
    })
  },
  deleteComment(project: string, commentId: number): Promise<void> {
    return request(`/api/projects/${enc(project)}/comments/${commentId}`, {
      method: "DELETE",
    })
  },

  // -- Labels (repo-level) --
  listLabels(project: string): Promise<Label[]> {
    return request(`/api/projects/${enc(project)}/labels`)
  },
  createLabel(
    project: string,
    payload: CreateLabelPayload,
  ): Promise<Label> {
    return request(`/api/projects/${enc(project)}/labels`, {
      method: "POST",
      ...json(payload),
    })
  },
  updateLabel(
    project: string,
    labelName: string,
    fields: UpdateLabelPayload,
  ): Promise<Label> {
    return request(
      `/api/projects/${enc(project)}/labels/${enc(labelName)}`,
      { method: "PATCH", ...json(fields) },
    )
  },
  deleteLabel(project: string, labelName: string): Promise<void> {
    return request(
      `/api/projects/${enc(project)}/labels/${enc(labelName)}`,
      { method: "DELETE" },
    )
  },

  // -- Labels (issue-level) --
  addIssueLabels(
    project: string,
    number: number,
    labels: string[],
  ): Promise<Label[]> {
    return request(
      `/api/projects/${enc(project)}/issues/${number}/labels`,
      { method: "POST", ...json({ labels }) },
    )
  },
  setIssueLabels(
    project: string,
    number: number,
    labels: string[],
  ): Promise<Label[]> {
    return request(
      `/api/projects/${enc(project)}/issues/${number}/labels`,
      { method: "PUT", ...json({ labels }) },
    )
  },
  removeIssueLabel(
    project: string,
    number: number,
    labelName: string,
  ): Promise<void> {
    return request(
      `/api/projects/${enc(project)}/issues/${number}/labels/${enc(labelName)}`,
      { method: "DELETE" },
    )
  },
  removeAllIssueLabels(
    project: string,
    number: number,
  ): Promise<void> {
    return request(
      `/api/projects/${enc(project)}/issues/${number}/labels`,
      { method: "DELETE" },
    )
  },

  // -- Amplifier --
  runAmplifier(
    project: string,
    issueNumber: number,
  ): Promise<AmplifierSessionInfo> {
    return request(
      `/api/projects/${enc(project)}/issues/${issueNumber}/amplifier`,
      { method: "POST" },
    )
  },
  getAmplifierStatus(
    project: string,
    issueNumber: number,
  ): Promise<AmplifierSessionInfo> {
    return request(
      `/api/projects/${enc(project)}/issues/${issueNumber}/amplifier`,
    )
  },
  cancelAmplifier(
    project: string,
    issueNumber: number,
  ): Promise<void> {
    return request(
      `/api/projects/${enc(project)}/issues/${issueNumber}/amplifier`,
      { method: "DELETE" },
    )
  },
  listAmplifierSessions(): Promise<AmplifierSessionInfo[]> {
    return request("/api/amplifier/sessions")
  },
}
