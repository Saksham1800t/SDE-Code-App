/** Canonical shapes for the github:* IPC boundary, scoped narrow (read PRs/issues, comments) — the access token never crosses back to the renderer. */

export interface GitHubDeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  /** Minimum seconds to wait between poll attempts, per GitHub's device flow spec. */
  interval: number;
}

export type GitHubPollResult =
  | { status: 'success'; login: string }
  | { status: 'pending' }
  | { status: 'error'; message: string };

export interface GitHubUser {
  login: string;
  avatarUrl: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  author: string;
  state: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  author: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

export interface GitHubPullRequestDetail extends GitHubPullRequestSummary {
  body: string;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
}

export interface GitHubFileEntry {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previousFilename?: string;
}

export interface GitHubComment {
  id: number;
  author: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
}

/** A line-anchored PR review comment (distinct from GitHubComment, which is
 * the top-level conversation thread) — GitHub's Pulls Review-Comments API. */
export interface GitHubReviewComment {
  id: number;
  author: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  diffHunk: string;
  inReplyToId?: number;
}

/** A comment attached to a review being submitted — not yet posted. */
export interface GitHubReviewDraftComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
}

export type GitHubReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export interface GitHubReview {
  id: number;
  author: string;
  state: string;
  body: string;
  submittedAt: string;
}

export type GitHubIpcContract = {
  'github:startDeviceFlow': (clientId: string) => Promise<GitHubDeviceCodeResponse>;
  /** One poll attempt — the renderer re-calls this every `interval` seconds itself rather than the main process maintaining polling state. On success, the token is stored server-side and never returned. */
  'github:pollForToken': (clientId: string, deviceCode: string) => Promise<GitHubPollResult>;
  'github:signOut': () => Promise<void>;
  'github:getCurrentUser': () => Promise<GitHubUser | null>;
  'github:listPullRequests': (owner: string, repo: string) => Promise<GitHubPullRequestSummary[]>;
  'github:listIssues': (owner: string, repo: string) => Promise<GitHubIssueSummary[]>;
  'github:getPullRequest': (owner: string, repo: string, number: number) => Promise<GitHubPullRequestDetail>;
  'github:getPullRequestFiles': (owner: string, repo: string, number: number) => Promise<GitHubFileEntry[]>;
  /** Full file content at a specific commit sha (via the Contents API) — empty string if the file doesn't exist at that ref (added/deleted in this PR), matching gitService.getCommitFileDiff's own not-found convention. */
  'github:getFileContentAtRef': (owner: string, repo: string, path: string, ref: string) => Promise<string>;
  'github:getComments': (owner: string, repo: string, number: number) => Promise<GitHubComment[]>;
  'github:postComment': (owner: string, repo: string, number: number, body: string) => Promise<GitHubComment>;
  /** Line-anchored review comments already posted on this PR (from any past review) — rendered inline under their line in GitHubPRFilesView. */
  'github:getReviewComments': (owner: string, repo: string, number: number) => Promise<GitHubReviewComment[]>;
  /** Submits a review in one call — GitHub's Reviews API creates the review AND every attached line comment together, rather than posting comments individually first. `commitSha` should be the PR's current head sha (GitHubPullRequestDetail.headSha). */
  'github:submitReview': (
    owner: string,
    repo: string,
    number: number,
    commitSha: string,
    event: GitHubReviewEvent,
    body: string,
    comments: GitHubReviewDraftComment[],
  ) => Promise<GitHubReview>;
};
