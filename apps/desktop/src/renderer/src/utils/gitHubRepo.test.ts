import { describe, expect, it } from 'vitest';
import { parseGitHubRemoteUrl } from './gitHubRepo';

describe('parseGitHubRemoteUrl', () => {
  it('parses an SSH remote URL with a .git suffix', () => {
    expect(parseGitHubRemoteUrl('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an SSH remote URL without a .git suffix', () => {
    expect(parseGitHubRemoteUrl('git@github.com:owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an HTTPS remote URL with a .git suffix', () => {
    expect(parseGitHubRemoteUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an HTTPS remote URL without a .git suffix', () => {
    expect(parseGitHubRemoteUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an HTTPS remote URL with a trailing slash', () => {
    expect(parseGitHubRemoteUrl('https://github.com/owner/repo/')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('parses an HTTPS remote URL with embedded credentials', () => {
    expect(parseGitHubRemoteUrl('https://x-access-token:ghp_abc123@github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('handles a repo name containing dots or hyphens', () => {
    expect(parseGitHubRemoteUrl('https://github.com/my-org/my.repo-name.git')).toEqual({
      owner: 'my-org',
      repo: 'my.repo-name',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseGitHubRemoteUrl('  git@github.com:owner/repo.git  ')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('returns null for a non-GitHub remote', () => {
    expect(parseGitHubRemoteUrl('https://gitlab.com/owner/repo.git')).toBeNull();
    expect(parseGitHubRemoteUrl('git@bitbucket.org:owner/repo.git')).toBeNull();
  });

  it('returns null for an empty or malformed string', () => {
    expect(parseGitHubRemoteUrl('')).toBeNull();
    expect(parseGitHubRemoteUrl('not a url')).toBeNull();
  });
});
