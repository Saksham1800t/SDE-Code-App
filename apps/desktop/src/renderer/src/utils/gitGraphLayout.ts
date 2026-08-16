import type { GitGraphCommit } from '../types/git';

export interface GitGraphSegment {
  /** Lane column this line segment occupies at the current row. */
  fromLane: number;
  /** Lane column the same line continues in at the next (older) row. */
  toLane: number;
}

export interface GitGraphRow {
  commit: GitGraphCommit;
  lane: number;
  /** Every line segment departing this row toward the next (older) row, self-contained per row so the renderer never has to re-derive lane liveness. */
  segments: GitGraphSegment[];
}

export interface GitGraphLayout {
  rows: GitGraphRow[];
  /** Maximum concurrent lanes across the whole layout — sizes the graph's width. */
  laneCount: number;
}

/** Assigns each commit a lane and connecting segments in one forward pass (newest-first order), using the same conceptual approach as git --graph: a lane holds a "promise" of the next expected hash, and a matching commit is placed in the lowest such lane. */
export function computeGraphLayout(commits: GitGraphCommit[]): GitGraphLayout {
  // activeLanes[lane] = the commit hash that lane currently expects next,
  // or null if the lane is free for reuse.
  const activeLanes: (string | null)[] = [];
  const rows: GitGraphRow[] = [];

  const allocateLane = (): number => {
    const free = activeLanes.indexOf(null);
    if (free !== -1) return free;
    activeLanes.push(null);
    return activeLanes.length - 1;
  };

  for (const commit of commits) {
    const waitingLanes: number[] = [];
    for (let l = 0; l < activeLanes.length; l++) {
      if (activeLanes[l] === commit.hash) waitingLanes.push(l);
    }

    const lane = waitingLanes.length > 0 ? Math.min(...waitingLanes) : allocateLane();
    const segments: GitGraphSegment[] = [];

    // Any other lane also waiting for this commit converges into `lane`.
    for (const l of waitingLanes) {
      if (l !== lane) segments.push({ fromLane: l, toLane: lane });
      activeLanes[l] = null;
    }
    // Lanes untouched by this commit just continue straight through.
    for (let l = 0; l < activeLanes.length; l++) {
      if (l === lane || waitingLanes.includes(l)) continue;
      if (activeLanes[l] !== null) segments.push({ fromLane: l, toLane: l });
    }

    const [firstParent, ...mergeParents] = commit.parents;
    if (firstParent) {
      activeLanes[lane] = firstParent;
      segments.push({ fromLane: lane, toLane: lane });
    } else {
      activeLanes[lane] = null; // root commit — this lane terminates here.
    }
    for (const parentHash of mergeParents) {
      let mergeLane = activeLanes.indexOf(parentHash);
      if (mergeLane === -1) mergeLane = allocateLane();
      activeLanes[mergeLane] = parentHash;
      segments.push({ fromLane: lane, toLane: mergeLane });
    }

    rows.push({ commit, lane, segments });
  }

  return { rows, laneCount: activeLanes.length };
}
