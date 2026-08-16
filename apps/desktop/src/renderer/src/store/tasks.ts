import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';
import { useTerminalStore } from './terminal';
import { useProblemsStore } from './problems';
import { matchProblemLines, type ProblemMatcherKind } from '../utils/problemMatcher';
import { TASK_DETECTORS } from '../utils/taskDetectors';
import { customAlert } from './alerts';
import { DIALOG_MESSAGES } from '../utils/dialogMessages';

export interface TaskDefinition {
  id: string;
  name: string;
  command: string;
  /** Relative to the owning workspace folder; omitted runs at that folder's root. */
  cwd?: string;
  problemMatcher?: ProblemMatcherKind;
  /** Omitted for hand-authored tasks; a detector id (e.g. 'npm') for auto-detected ones — see utils/taskDetectors. Drives TaskPickerDialog's source badge. */
  source?: string;
}

const TASKS_FILE_RELATIVE = '.sde/tasks.json';

interface TasksState {
  tasks: TaskDefinition[];
  loading: boolean;
  /** Which terminal a problem-matched run is attributed to; output from any other terminal is ignored for task-problem purposes. */
  activeTaskTerminalId: string | null;
  loadTasks: () => Promise<void>;
  runTask: (task: TaskDefinition) => void;
}

let outputUnsubscribe: (() => void) | null = null;
// Re-matched in full on every chunk (not incrementally) since a streamed diagnostic could span a chunk boundary.
let accumulatedOutput = '';

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  activeTaskTerminalId: null,

  loadTasks: async () => {
    const api = window.api;
    const folder = useWorkspaceStore.getState().activeFolderPath ?? useWorkspaceStore.getState().workspaceFolders[0]?.path;
    if (!api || !folder) {
      set({ tasks: [] });
      return;
    }
    set({ loading: true });
    try {
      const normalizedFolder = folder.replace(/\\/g, '/');

      const fileTasks: TaskDefinition[] = await api
        .readFile(`${normalizedFolder}/${TASKS_FILE_RELATIVE}`)
        .then((raw) => {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? (parsed as TaskDefinition[]) : [];
        })
        // No .sde/tasks.json yet (or invalid JSON) — same as "no tasks configured", not an error the user needs to see.
        .catch(() => []);

      // Each detector reads its own marker file independently, so one missing marker can't suppress another detector's results or the file tasks above.
      const detectedTasks = (
        await Promise.all(
          TASK_DETECTORS.map((detector) =>
            api
              .readFile(`${normalizedFolder}/${detector.markerFile}`)
              .then((content) =>
                detector.parse(content).map((task): TaskDefinition => ({
                  ...task,
                  id: `${detector.id}:${task.id}`,
                  source: detector.id,
                })),
              )
              .catch(() => []),
          ),
        )
      ).flat();

      set({ tasks: [...fileTasks, ...detectedTasks] });
    } finally {
      set({ loading: false });
    }
  },

  runTask: (task: TaskDefinition) => {
    const api = window.api;
    if (!api) return;
    const folder = useWorkspaceStore.getState().activeFolderPath ?? useWorkspaceStore.getState().workspaceFolders[0]?.path;
    if (!folder) return;
    const cwd = task.cwd ? `${folder.replace(/\\/g, '/')}/${task.cwd}` : folder;

    useTerminalStore.getState().createNewTerminal(cwd);
    const terminalId = useTerminalStore.getState().activeTerminalId;
    if (!terminalId) return;

    const matcher = task.problemMatcher ?? 'none';
    accumulatedOutput = '';
    useProblemsStore.getState().setTaskProblems([]);
    outputUnsubscribe?.();
    outputUnsubscribe = null;

    if (matcher !== 'none') {
      set({ activeTaskTerminalId: terminalId });
      outputUnsubscribe = api.onTerminalOutput?.((eventData) => {
        if (eventData.terminalId !== get().activeTaskTerminalId) return;
        accumulatedOutput += eventData.data;
        const entries = matchProblemLines(accumulatedOutput.split(/\r\n|\r|\n/), matcher, cwd);
        useProblemsStore.getState().setTaskProblems(entries);
      }) ?? null;
    }

    // Short delay before typing the command so it doesn't interleave with the shell's own startup banner — cosmetic only, not required for correctness.
    setTimeout(() => {
      api.writeTerminal?.(terminalId, `${task.command}\r`);
    }, 400);
  },
}));

/** Exposed for the Command Palette / Terminal panel entry points — validates
 * there's at least one task configured before bothering to open a picker. */
export function ensureTasksLoadedThenAlertIfEmpty(onReady: () => void): void {
  useTasksStore.getState().loadTasks().then(() => {
    if (useTasksStore.getState().tasks.length === 0) {
      customAlert(DIALOG_MESSAGES.tasks.noTasksConfigured);
      return;
    }
    onReady();
  });
}
