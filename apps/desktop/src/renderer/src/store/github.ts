import { create } from 'zustand';
import type {
  GitHubUser,
  GitHubDeviceCodeResponse,
  GitHubPullRequestSummary,
  GitHubIssueSummary,
  GitHubPullRequestDetail,
  GitHubFileEntry,
  GitHubComment,
  GitHubReviewComment,
  GitHubReviewDraftComment,
  GitHubReviewEvent,
} from '@sde-code/protocol';
import { parseGitHubRemoteUrl, type GitHubRepoRef } from '../utils/gitHubRepo';
import { notify } from './notifications';

// Device-flow client ids aren't secret (no client_secret needed) — swap for your own GitHub OAuth App's client id if you fork this project.
const GITHUB_CLIENT_ID: string = 'Ov23liCr9ZYCUGZfVobE';
const GITHUB_CLIENT_ID_IS_PLACEHOLDER = GITHUB_CLIENT_ID === 'REPLACE_WITH_YOUR_GITHUB_OAUTH_CLIENT_ID';

interface GitHubState {
  user: GitHubUser | null;
  isAuthenticating: boolean;
  deviceCode: GitHubDeviceCodeResponse | null;

  repo: GitHubRepoRef | null;

  pullRequests: GitHubPullRequestSummary[];
  issues: GitHubIssueSummary[];
  loadingList: boolean;

  activePullRequest: GitHubPullRequestDetail | null;
  activePullRequestFiles: GitHubFileEntry[];
  activeIssue: GitHubIssueSummary | null;
  comments: GitHubComment[];
  loadingDetail: boolean;
  postingComment: boolean;
  commentError: string | null;

  /** Line-anchored review comments already posted on the active PR (from any past review). */
  reviewComments: GitHubReviewComment[];
  /** Comments composed locally, not yet submitted — cleared on submit or on closing/switching PRs. */
  draftComments: GitHubReviewDraftComment[];
  submittingReview: boolean;
  reviewSubmitError: string | null;

  /** Checks for an already-stored token (from a previous session) — call once on app mount. */
  initialize: () => Promise<void>;
  startAuth: () => Promise<void>;
  cancelAuth: () => void;
  signOut: () => Promise<void>;
  detectRepo: (workspacePath: string) => Promise<void>;
  loadPullRequests: () => Promise<void>;
  loadIssues: () => Promise<void>;
  openPullRequest: (number: number) => Promise<void>;
  /** Issues have no dedicated detail endpoint — reuses whatever summary (including body) is already loaded into `issues` via loadIssues, and fetches only the comment thread. */
  openIssue: (number: number) => Promise<void>;
  closePullRequest: () => void;
  postComment: (number: number, body: string) => Promise<boolean>;
  /** Adds one comment to the local draft — accumulates until "Submit Review". */
  addDraftComment: (path: string, line: number, side: 'LEFT' | 'RIGHT', body: string) => void;
  removeDraftComment: (index: number) => void;
  /** Posts the review AND every draft comment together in one GitHub API call, then reloads reviewComments from the server (the create-review response doesn't reliably echo back full comment objects) and clears the draft. */
  submitReview: (event: GitHubReviewEvent, body: string) => Promise<boolean>;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

const clearPoll = () => {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
};

export const useGitHubStore = create<GitHubState>((set, get) => ({
  user: null,
  isAuthenticating: false,
  deviceCode: null,

  repo: null,

  pullRequests: [],
  issues: [],
  loadingList: false,

  activePullRequest: null,
  activePullRequestFiles: [],
  activeIssue: null,
  comments: [],
  loadingDetail: false,
  postingComment: false,
  commentError: null,

  reviewComments: [],
  draftComments: [],
  submittingReview: false,
  reviewSubmitError: null,

  initialize: async () => {
    const api = window.api;
    if (!api?.githubGetCurrentUser) return;
    try {
      const user = await api.githubGetCurrentUser();
      if (user) set({ user });
    } catch (err) {
      console.error('Failed to check existing GitHub session:', err);
    }
  },

  startAuth: async () => {
    const api = window.api;
    if (!api) return;
    if (GITHUB_CLIENT_ID_IS_PLACEHOLDER) {
      notify.error(
        'This build has no GitHub OAuth App configured yet — register one at github.com/settings/developers and set GITHUB_CLIENT_ID in store/github.ts.',
        'GitHub integration not set up',
      );
      return;
    }
    clearPoll();
    set({ isAuthenticating: true, deviceCode: null });

    try {
      const codeResponse = await api.githubStartDeviceFlow(GITHUB_CLIENT_ID);
      set({ deviceCode: codeResponse });

      const deadline = Date.now() + codeResponse.expiresIn * 1000;
      const intervalMs = Math.max(codeResponse.interval, 5) * 1000;

      const poll = async () => {
        // Cancelled (or superseded by a newer startAuth call) while the
        // previous poll's own await was in flight.
        if (!get().isAuthenticating) return;
        if (Date.now() > deadline) {
          set({ isAuthenticating: false, deviceCode: null });
          notify.warning('The code expired before authorization completed. Try again.', 'GitHub Sign-In');
          return;
        }

        const result = await api.githubPollForToken(GITHUB_CLIENT_ID, codeResponse.deviceCode);
        if (!get().isAuthenticating) return; // cancelled mid-poll

        if (result.status === 'success') {
          set({ isAuthenticating: false, deviceCode: null, user: { login: result.login, avatarUrl: '' } });
          const user = await api.githubGetCurrentUser().catch(() => null);
          if (user) set({ user });
          return;
        }
        if (result.status === 'error') {
          set({ isAuthenticating: false, deviceCode: null });
          notify.error(result.message, 'GitHub Sign-In Failed');
          return;
        }
        pollTimer = setTimeout(poll, intervalMs);
      };
      pollTimer = setTimeout(poll, intervalMs);
    } catch (err: any) {
      set({ isAuthenticating: false, deviceCode: null });
      notify.error(err?.message || 'Failed to start GitHub authentication.', 'GitHub Sign-In Failed');
    }
  },

  cancelAuth: () => {
    clearPoll();
    set({ isAuthenticating: false, deviceCode: null });
  },

  signOut: async () => {
    const api = window.api;
    clearPoll();
    await api?.githubSignOut?.();
    set({ user: null, pullRequests: [], issues: [], activePullRequest: null, activePullRequestFiles: [], activeIssue: null, comments: [] });
  },

  detectRepo: async (workspacePath) => {
    const api = window.api;
    if (!api?.gitGetRemotes) {
      set({ repo: null });
      return;
    }
    try {
      const remotes = await api.gitGetRemotes(workspacePath);
      const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
      if (!origin) {
        set({ repo: null });
        return;
      }
      set({ repo: parseGitHubRemoteUrl(origin.refs.fetch || origin.refs.push || '') });
    } catch (err) {
      console.error('Failed to detect GitHub repo from git remotes:', err);
      set({ repo: null });
    }
  },

  loadPullRequests: async () => {
    const api = window.api;
    const repo = get().repo;
    if (!api?.githubListPullRequests || !repo) return;
    set({ loadingList: true });
    try {
      const pullRequests = await api.githubListPullRequests(repo.owner, repo.repo);
      set({ pullRequests });
    } catch (err) {
      console.error('Failed to load pull requests:', err);
    } finally {
      set({ loadingList: false });
    }
  },

  loadIssues: async () => {
    const api = window.api;
    const repo = get().repo;
    if (!api?.githubListIssues || !repo) return;
    set({ loadingList: true });
    try {
      const issues = await api.githubListIssues(repo.owner, repo.repo);
      set({ issues });
    } catch (err) {
      console.error('Failed to load issues:', err);
    } finally {
      set({ loadingList: false });
    }
  },

  openPullRequest: async (number) => {
    const api = window.api;
    const repo = get().repo;
    if (!api || !repo) return;
    set({
      loadingDetail: true, activePullRequest: null, activePullRequestFiles: [], activeIssue: null,
      comments: [], commentError: null, reviewComments: [], draftComments: [], reviewSubmitError: null,
    });
    try {
      const [detail, files, comments, reviewComments] = await Promise.all([
        api.githubGetPullRequest(repo.owner, repo.repo, number),
        api.githubGetPullRequestFiles(repo.owner, repo.repo, number),
        api.githubGetComments(repo.owner, repo.repo, number),
        api.githubGetReviewComments(repo.owner, repo.repo, number),
      ]);
      set({ activePullRequest: detail, activePullRequestFiles: files, comments, reviewComments });
    } catch (err) {
      console.error(`Failed to load PR #${number}:`, err);
    } finally {
      set({ loadingDetail: false });
    }
  },

  openIssue: async (number) => {
    const api = window.api;
    const repo = get().repo;
    if (!api || !repo) return;
    set({
      loadingDetail: true, activePullRequest: null, activePullRequestFiles: [], activeIssue: null,
      comments: [], commentError: null, reviewComments: [], draftComments: [], reviewSubmitError: null,
    });
    try {
      // No dedicated issue-detail endpoint — reuse the summary loadIssues() already fetched, falling back to whatever's cached.
      const existing = get().issues.find((i) => i.number === number) ?? null;
      const comments = await api.githubGetComments(repo.owner, repo.repo, number);
      set({ activeIssue: existing, comments });
    } catch (err) {
      console.error(`Failed to load issue #${number}:`, err);
    } finally {
      set({ loadingDetail: false });
    }
  },

  closePullRequest: () => {
    set({
      activePullRequest: null, activePullRequestFiles: [], activeIssue: null, comments: [], commentError: null,
      reviewComments: [], draftComments: [], reviewSubmitError: null,
    });
  },

  postComment: async (number, body) => {
    const api = window.api;
    const repo = get().repo;
    const trimmed = body.trim();
    if (!api || !repo || !trimmed) return false;
    set({ postingComment: true, commentError: null });
    try {
      const comment = await api.githubPostComment(repo.owner, repo.repo, number, trimmed);
      set({ comments: [...get().comments, comment] });
      return true;
    } catch (err: any) {
      set({ commentError: err?.message || 'Failed to post comment.' });
      return false;
    } finally {
      set({ postingComment: false });
    }
  },

  addDraftComment: (path, line, side, body) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    set({ draftComments: [...get().draftComments, { path, line, side, body: trimmed }] });
  },

  removeDraftComment: (index) => {
    set({ draftComments: get().draftComments.filter((_, i) => i !== index) });
  },

  submitReview: async (event, body) => {
    const api = window.api;
    const repo = get().repo;
    const pr = get().activePullRequest;
    const { draftComments } = get();
    if (!api || !repo || !pr) return false;
    if (draftComments.length === 0 && !body.trim() && event === 'COMMENT') {
      set({ reviewSubmitError: 'Add at least one comment or a summary before submitting.' });
      return false;
    }

    set({ submittingReview: true, reviewSubmitError: null });
    try {
      await api.githubSubmitReview(repo.owner, repo.repo, pr.number, pr.headSha, event, body.trim(), draftComments);
      const reviewComments = await api.githubGetReviewComments(repo.owner, repo.repo, pr.number);
      set({ reviewComments, draftComments: [] });
      return true;
    } catch (err: any) {
      set({ reviewSubmitError: err?.message || 'Failed to submit review.' });
      return false;
    } finally {
      set({ submittingReview: false });
    }
  },
}));
