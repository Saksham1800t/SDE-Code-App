import { npmDetector } from './npmScripts';
import type { TaskDetector } from './types';

export type { TaskDetector, DetectedTask } from './types';

/** Registry of project-script detectors, tried in order every time loadTasks() runs; each contributes tasks merged alongside .sde/tasks.json's hand-authored ones. To add a language, write a pure `content -> DetectedTask[]` parser (see npmScripts.ts) and append a TaskDetector below. */
export const TASK_DETECTORS: TaskDetector[] = [npmDetector];
