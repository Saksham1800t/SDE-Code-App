export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/** Parses a git remote URL (SSH or HTTPS, with or without credentials/.git suffix) into a GitHub owner/repo pair. Returns null for anything not a recognizable github.com remote. */
export function parseGitHubRemoteUrl(remoteUrl: string): GitHubRepoRef | null {
  const trimmed = remoteUrl.trim();

  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(\.git)?\/?$/.exec(trimmed);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const httpsMatch = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+?)(\.git)?\/?$/.exec(trimmed);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}
