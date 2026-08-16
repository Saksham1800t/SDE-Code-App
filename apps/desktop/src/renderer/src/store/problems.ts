import { create } from 'zustand';

export interface ProblemEntry {
  /** Normalized (forward slashes) — matches how workspace.ts stores tab.path. */
  filePath: string;
  fileName: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
}

const SEVERITY_RANK: Record<ProblemEntry['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

/** Monaco's own MarkerSeverity enum values (Error=8, Warning=4, Info=2, Hint=1). */
export const severityFromMonaco = (value: number): ProblemEntry['severity'] => {
  if (value === 8) return 'error';
  if (value === 4) return 'warning';
  if (value === 2) return 'info';
  return 'hint';
};

/** The status bar's "N errors, N warnings" summary — singular/plural correct at exactly 1 of either. */
export const formatProblemsSummary = (errorCount: number, warningCount: number): string =>
  `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warningCount} warning${warningCount === 1 ? '' : 's'}`;

/** A marker's resource.fsPath comes back as a native OS path (backslashes on Windows) and must be normalized to forward-slash to match tab.path. */
export const mapMarkersToProblems = (markers: any[]): ProblemEntry[] => {
  return markers.map((m: any) => {
    const rawPath: string = m.resource?.fsPath ?? m.resource?.path ?? '';
    const filePath = rawPath.replace(/\\/g, '/');
    return {
      filePath,
      fileName: filePath.split('/').pop() || filePath,
      line: m.startLineNumber,
      column: m.startColumn,
      endLine: m.endLineNumber,
      endColumn: m.endColumn,
      message: m.message,
      severity: severityFromMonaco(m.severity),
      source: m.source,
    };
  });
};

/** Two-tier ordering: files sort by worst severity then alphabetically; within a file, markers sort by severity then position. */
export const sortProblems = (entries: ProblemEntry[]): ProblemEntry[] => {
  const worstRankByFile = new Map<string, number>();
  for (const entry of entries) {
    const rank = SEVERITY_RANK[entry.severity];
    const current = worstRankByFile.get(entry.filePath);
    if (current === undefined || rank < current) worstRankByFile.set(entry.filePath, rank);
  }

  return [...entries].sort((a, b) => {
    const fileRankA = worstRankByFile.get(a.filePath)!;
    const fileRankB = worstRankByFile.get(b.filePath)!;
    if (fileRankA !== fileRankB) return fileRankA - fileRankB;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);

    const rankA = SEVERITY_RANK[a.severity];
    const rankB = SEVERITY_RANK[b.severity];
    if (rankA !== rankB) return rankA - rankB;
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
};

interface ProblemsState {
  /** Merged, sorted view of monacoProblems + taskProblems, read by every consumer. Kept in sync by both recomputeFromMarkers and setTaskProblems so neither source clobbers the other. */
  problems: ProblemEntry[];
  /** Raw Monaco-marker-derived entries only, kept separately so setTaskProblems can re-merge without needing a monaco instance on hand. */
  monacoProblems: ProblemEntry[];
  /** Raw Task Runner problem-matcher entries only, from the most recent task
   * run (see store/tasks.ts) — replaced wholesale on each new run. */
  taskProblems: ProblemEntry[];
  errorCount: number;
  warningCount: number;
  recomputeFromMarkers: (monaco: any) => void;
  setTaskProblems: (entries: ProblemEntry[]) => void;
}

const mergeAndCount = (monacoProblems: ProblemEntry[], taskProblems: ProblemEntry[]) => {
  const problems = sortProblems([...monacoProblems, ...taskProblems]);
  const errorCount = problems.reduce((n, e) => n + (e.severity === 'error' ? 1 : 0), 0);
  const warningCount = problems.reduce((n, e) => n + (e.severity === 'warning' ? 1 : 0), 0);
  return { problems, errorCount, warningCount };
};

export const useProblemsStore = create<ProblemsState>((set, get) => ({
  problems: [],
  monacoProblems: [],
  taskProblems: [],
  errorCount: 0,
  warningCount: 0,

  recomputeFromMarkers: (monaco: any) => {
    const markers = monaco.editor.getModelMarkers({});
    const monacoProblems = mapMarkersToProblems(markers);
    set({ monacoProblems, ...mergeAndCount(monacoProblems, get().taskProblems) });
  },

  setTaskProblems: (entries: ProblemEntry[]) => {
    set({ taskProblems: entries, ...mergeAndCount(get().monacoProblems, entries) });
  },
}));
