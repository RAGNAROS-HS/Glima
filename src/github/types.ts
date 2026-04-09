export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  html_url: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  user: { login: string };
  html_url: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export interface IssuePayload {
  action: string;
  issue: GitHubIssue;
  label?: { name: string };
  sender: { login: string };
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
}

export interface PRPayload {
  action: string;
  pull_request: GitHubPR;
  sender: { login: string };
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
}

export interface PushPayload {
  sender: { login: string };
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
}

export interface InstallationPayload {
  action: string;
  installation: { id: number };
  repositories?: Array<{ name: string }>;
}
