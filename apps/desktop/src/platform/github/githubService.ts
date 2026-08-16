import type {
  GitHubDeviceCodeResponse,
  GitHubPollResult,
  GitHubUser,
  GitHubPullRequestSummary,
  GitHubIssueSummary,
  GitHubPullRequestDetail,
  GitHubFileEntry,
  GitHubComment,
  GitHubReviewComment,
  GitHubReviewDraftComment,
  GitHubReviewEvent,
  GitHubReview,
} from '@sde-code/protocol';
import { createServiceIdentifier } from '../instantiation';
import { ILogService } from '../log';
import { IDatabaseService } from '../db';

const GITHUB_TOKEN_SETTING_KEY = 'github-access-token';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_BASE = 'https://api.github.com';

export interface IGitHubService {
  startDeviceFlow(clientId: string): Promise<GitHubDeviceCodeResponse>;
  pollForToken(clientId: string, deviceCode: string): Promise<GitHubPollResult>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<GitHubUser | null>;
  listPullRequests(owner: string, repo: string): Promise<GitHubPullRequestSummary[]>;
  listIssues(owner: string, repo: string): Promise<GitHubIssueSummary[]>;
  getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequestDetail>;
  getPullRequestFiles(owner: string, repo: string, number: number): Promise<GitHubFileEntry[]>;
  getFileContentAtRef(owner: string, repo: string, path: string, ref: string): Promise<string>;
  getComments(owner: string, repo: string, number: number): Promise<GitHubComment[]>;
  postComment(owner: string, repo: string, number: number, body: string): Promise<GitHubComment>;
  getReviewComments(owner: string, repo: string, number: number): Promise<GitHubReviewComment[]>;
  submitReview(
    owner: string,
    repo: string,
    number: number,
    commitSha: string,
    event: GitHubReviewEvent,
    body: string,
    comments: GitHubReviewDraftComment[],
  ): Promise<GitHubReview>;
}

export const IGitHubService = createServiceIdentifier<IGitHubService>('githubService');

/** GitHub's device-flow OAuth (no client secret, same mechanism the GitHub CLI uses) plus a thin read+comment REST client; the token is stored via databaseService.setSetting and never crosses back to the renderer. */
export class GitHubService implements IGitHubService {
  static readonly inject = [ILogService, IDatabaseService] as const;
  constructor(
    private readonly logService: ILogService,
    private readonly databaseService: IDatabaseService,
  ) {}

  private getToken(): string | null {
    return this.databaseService.getSettings()[GITHUB_TOKEN_SETTING_KEY] || null;
  }

  private async apiFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = this.getToken();
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.headers || {}),
      },
    });
  }

  async startDeviceFlow(clientId: string): Promise<GitHubDeviceCodeResponse> {
    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error_description || data.error || 'Failed to start GitHub device flow.');
    }
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  async pollForToken(clientId: string, deviceCode: string): Promise<GitHubPollResult> {
    try {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const data = await res.json();

      if (data.access_token) {
        this.databaseService.setSetting(GITHUB_TOKEN_SETTING_KEY, data.access_token);
        const user = await this.getCurrentUser();
        return { status: 'success', login: user?.login ?? '' };
      }
      // GitHub's own vocabulary: keep polling for these two, anything else
      // (expired_token, access_denied, unsupported_grant_type, ...) is terminal.
      if (data.error === 'authorization_pending' || data.error === 'slow_down') {
        return { status: 'pending' };
      }
      return { status: 'error', message: data.error_description || data.error || 'Authorization failed.' };
    } catch (err) {
      this.logService.error('GitHub device flow poll failed:', err);
      return { status: 'error', message: 'Network error while polling for authorization.' };
    }
  }

  async signOut(): Promise<void> {
    this.databaseService.setSetting(GITHUB_TOKEN_SETTING_KEY, '');
  }

  async getCurrentUser(): Promise<GitHubUser | null> {
    if (!this.getToken()) return null;
    try {
      const res = await this.apiFetch('/user');
      if (!res.ok) return null;
      const data = await res.json();
      return { login: data.login, avatarUrl: data.avatar_url };
    } catch (err) {
      this.logService.error('Failed to fetch GitHub user:', err);
      return null;
    }
  }

  async listPullRequests(owner: string, repo: string): Promise<GitHubPullRequestSummary[]> {
    try {
      const res = await this.apiFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=50`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map((pr) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login ?? '',
        state: pr.state,
        draft: !!pr.draft,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
      }));
    } catch (err) {
      this.logService.error('Failed to list pull requests:', err);
      return [];
    }
  }

  async listIssues(owner: string, repo: string): Promise<GitHubIssueSummary[]> {
    try {
      const res = await this.apiFetch(`/repos/${owner}/${repo}/issues?state=open&per_page=50`);
      if (!res.ok) return [];
      const data = await res.json();
      // GitHub's issues endpoint also returns every open PR — filter those out since listPullRequests covers them separately with PR-specific fields.
      return (data as any[])
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          author: issue.user?.login ?? '',
          state: issue.state,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          body: issue.body ?? '',
        }));
    } catch (err) {
      this.logService.error('Failed to list issues:', err);
      return [];
    }
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequestDetail> {
    const res = await this.apiFetch(`/repos/${owner}/${repo}/pulls/${number}`);
    if (!res.ok) throw new Error(`Failed to fetch PR #${number} (${res.status})`);
    const pr = await res.json();
    return {
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? '',
      state: pr.state,
      draft: !!pr.draft,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      body: pr.body ?? '',
      baseSha: pr.base?.sha ?? '',
      headSha: pr.head?.sha ?? '',
      baseRef: pr.base?.ref ?? '',
      headRef: pr.head?.ref ?? '',
    };
  }

  async getPullRequestFiles(owner: string, repo: string, number: number): Promise<GitHubFileEntry[]> {
    try {
      const res = await this.apiFetch(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
      }));
    } catch (err) {
      this.logService.error('Failed to list PR files:', err);
      return [];
    }
  }

  async getFileContentAtRef(owner: string, repo: string, path: string, ref: string): Promise<string> {
    try {
      // Contents API wants each path segment percent-encoded but the '/' separators literal — plain encodeURIComponent would also encode those.
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const res = await this.apiFetch(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`);
      if (!res.ok) return ''; // 404 = file added/deleted at this ref — treat as empty, matching getCommitFileDiff's own convention.
      const data = await res.json();
      if (data.encoding === 'base64' && typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
      return '';
    } catch (err) {
      this.logService.error(`Failed to fetch file content for ${path}@${ref}:`, err);
      return '';
    }
  }

  async getComments(owner: string, repo: string, number: number): Promise<GitHubComment[]> {
    try {
      const res = await this.apiFetch(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map((c) => ({
        id: c.id,
        author: c.user?.login ?? '',
        avatarUrl: c.user?.avatar_url ?? '',
        body: c.body ?? '',
        createdAt: c.created_at,
      }));
    } catch (err) {
      this.logService.error('Failed to fetch comments:', err);
      return [];
    }
  }

  async postComment(owner: string, repo: string, number: number, body: string): Promise<GitHubComment> {
    const res = await this.apiFetch(`/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}) as any);
      throw new Error(errData.message || `Failed to post comment (${res.status}).`);
    }
    const c = await res.json();
    return { id: c.id, author: c.user?.login ?? '', avatarUrl: c.user?.avatar_url ?? '', body: c.body ?? '', createdAt: c.created_at };
  }

  async getReviewComments(owner: string, repo: string, number: number): Promise<GitHubReviewComment[]> {
    try {
      const res = await this.apiFetch(`/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data as any[]).map((c) => ({
        id: c.id,
        author: c.user?.login ?? '',
        avatarUrl: c.user?.avatar_url ?? '',
        body: c.body ?? '',
        createdAt: c.created_at,
        path: c.path,
        // A comment on a deleted line has `line: null` but `original_line` set — fall back so old comments still anchor somewhere.
        line: c.line ?? c.original_line ?? null,
        side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
        diffHunk: c.diff_hunk ?? '',
        ...(c.in_reply_to_id ? { inReplyToId: c.in_reply_to_id } : {}),
      }));
    } catch (err) {
      this.logService.error('Failed to fetch review comments:', err);
      return [];
    }
  }

  async submitReview(
    owner: string,
    repo: string,
    number: number,
    commitSha: string,
    event: GitHubReviewEvent,
    body: string,
    comments: GitHubReviewDraftComment[],
  ): Promise<GitHubReview> {
    const res = await this.apiFetch(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        commit_id: commitSha,
        body,
        event,
        comments: comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}) as any);
      throw new Error(errData.message || `Failed to submit review (${res.status}).`);
    }
    const r = await res.json();
    return {
      id: r.id,
      author: r.user?.login ?? '',
      state: r.state,
      body: r.body ?? '',
      submittedAt: r.submitted_at ?? '',
    };
  }
}
