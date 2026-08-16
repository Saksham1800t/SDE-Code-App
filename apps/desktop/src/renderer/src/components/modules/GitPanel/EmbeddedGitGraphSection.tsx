import React, { useEffect, useState } from 'react';
import { useGitStore } from '../../../store/git';
import type { GitRepoRoot } from '../../../store/git';
import { EmbeddedGitGraph } from './EmbeddedGitGraph';

interface EmbeddedGitGraphSectionProps {
  workspacePath: string;
}

/** Discovers git repos nested within the workspace folder and renders one EmbeddedGitGraph per repo found; per-repo headers only if more than one. */
export const EmbeddedGitGraphSection: React.FC<EmbeddedGitGraphSectionProps> = ({ workspacePath }) => {
  const { gitDiscoverRepos } = useGitStore();
  const [repos, setRepos] = useState<GitRepoRoot[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepos(null);
    gitDiscoverRepos(workspacePath)
      .then((found) => {
        if (!cancelled) setRepos(found);
      })
      .catch((err) => {
        console.error('Failed to discover git repos:', err);
        if (!cancelled) setRepos([]);
      });
    return () => { cancelled = true; };
  }, [workspacePath]);

  if (!repos || repos.length === 0) return null;

  return (
    <>
      {repos.map((repo) => (
        <EmbeddedGitGraph key={repo.path} repoPath={repo.path} repoName={repo.name} showHeader={repos.length > 1} />
      ))}
    </>
  );
};
