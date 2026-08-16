import { describe, expect, it } from 'vitest';
import { computeGraphLayout } from './gitGraphLayout';
import type { GitGraphCommit } from '../types/git';

function commit(hash: string, parents: string[]): GitGraphCommit {
  return { hash, shortHash: hash.slice(0, 7), message: hash, author: 'Test', date: '2026-01-01T00:00:00Z', refs: '', parents };
}

describe('computeGraphLayout', () => {
  it('keeps a linear chain in a single lane', () => {
    const commits = [commit('c3', ['c2']), commit('c2', ['c1']), commit('c1', [])];

    const { rows, laneCount } = computeGraphLayout(commits);

    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(laneCount).toBe(1);
  });

  it('gives a root commit (no parents) a lane that terminates there', () => {
    const commits = [commit('c1', [])];

    const { rows } = computeGraphLayout(commits);

    expect(rows[0].lane).toBe(0);
    // No forward-continuing vertical segment for the (now-closed) lane.
    expect(rows[0].segments.find((s) => s.fromLane === 0 && s.toLane === 0)).toBeUndefined();
  });

  it('a branch + merge opens a second lane that converges back into the first', () => {
    // merge (parents: p1, p2) -> p1 -> base ; merge -> p2 -> base
    const commits = [
      commit('merge', ['p1', 'p2']),
      commit('p1', ['base']),
      commit('p2', ['base']),
      commit('base', []),
    ];

    const { rows, laneCount } = computeGraphLayout(commits);
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]));

    expect(byHash.merge.lane).toBe(0);
    // The merge commit diverges into a second lane for its second parent.
    expect(byHash.merge.segments).toContainEqual({ fromLane: 0, toLane: 1 });
    expect(byHash.p1.lane).toBe(0);
    expect(byHash.p2.lane).toBe(1);
    // Both p1 and p2 converge back into lane 0 at "base".
    expect(byHash.base.lane).toBe(0);
    expect(byHash.base.segments).toContainEqual({ fromLane: 1, toLane: 0 });
    expect(laneCount).toBe(2);
  });

  it('a fork point (one parent, two children) allocates a second lane for the non-primary child', () => {
    // Two independent tips, a and b, both children of the same parent "fork".
    const commits = [commit('a', ['fork']), commit('b', ['fork']), commit('fork', [])];

    const { rows, laneCount } = computeGraphLayout(commits);
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]));

    expect(byHash.a.lane).toBe(0);
    expect(byHash.b.lane).toBe(1);
    // Both a's and b's lines converge at the fork point.
    expect(byHash.fork.lane).toBe(0);
    expect(byHash.fork.segments).toContainEqual({ fromLane: 1, toLane: 0 });
    expect(laneCount).toBe(2);
  });

  it('reuses a freed lane for a later, unrelated tip instead of growing laneCount unboundedly', () => {
    // "a" and "base1" form one short-lived branch off a root that ends quickly;
    // "b" is an entirely separate, later-appearing tip that should reuse
    // whatever lane freed up rather than allocating a third lane.
    const commits = [
      commit('a', ['root']),   // lane 0 (tip)
      commit('root', []),      // lane 0, root — lane 0 closes here
      commit('b', ['root2']),  // unrelated new tip — should reuse lane 0
      commit('root2', []),
    ];

    const { rows, laneCount } = computeGraphLayout(commits);
    const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]));

    expect(byHash.a.lane).toBe(0);
    expect(byHash.root.lane).toBe(0);
    expect(byHash.b.lane).toBe(0); // reused, not a new lane 1
    expect(laneCount).toBe(1);
  });

  it('returns an empty layout for an empty commit list', () => {
    const { rows, laneCount } = computeGraphLayout([]);
    expect(rows).toEqual([]);
    expect(laneCount).toBe(0);
  });
});
