import { create } from 'zustand';
import { useWorkspaceStore } from './workspace';
import { useAgentStore } from './agent';
import { notify } from './notifications';

export type ThreadStatus = 'starting' | 'running' | 'done' | 'error' | 'stopped';

export interface ThreadMessage {
  role: 'assistant' | 'tool' | 'approval';
  text: string;
  approval?: { requestId: string; toolName: string; argsSummary: string; resolved?: 'approved' | 'denied' };
}

export interface AgentThread {
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  status: ThreadStatus;
  error?: string;
  repoRoot: string;
  branchName: string;
  worktreePath: string;
  messages: ThreadMessage[];
  changedFileCount?: number;
}

interface ThreadsState {
  threads: Record<string, AgentThread>;
  order: string[];
  activeThreadId: string | null;
  setActiveThread: (id: string | null) => void;
  startThread: (prompt: string) => Promise<void>;
  respondApproval: (threadId: string, requestId: string, approved: boolean) => void;
  stopThread: (threadId: string) => void;
  /** Removes the thread from the list and deletes its worktree — the thread's proposed changes are gone unless already merged/pushed by the agent itself. */
  discardThread: (threadId: string) => Promise<void>;
}

function appendMessage(thread: AgentThread, msg: ThreadMessage): AgentThread {
  return { ...thread, messages: [...thread.messages, msg] };
}

export const useThreadsStore = create<ThreadsState>((set, get) => ({
  threads: {},
  order: [],
  activeThreadId: null,

  setActiveThread: (id) => set({ activeThreadId: id }),

  startThread: async (prompt) => {
    const api = window.api;
    if (!api) return;

    const { workspacePath, workspaceFolders } = useWorkspaceStore.getState();
    const repoRoot = workspacePath || workspaceFolders[0]?.path;
    if (!repoRoot) return;

    const isRepo = await api.gitStatus(repoRoot).then((s) => s.isRepo).catch(() => false);
    if (!isRepo) return;

    const threadId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const slug = prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30).replace(/(^-|-$)/g, '') || 'task';
    const branchName = `sde-thread/${slug}-${Date.now().toString(36)}`;

    let worktreePath: string;
    try {
      worktreePath = await api.gitCreateWorktree(repoRoot, branchName);
    } catch (err: any) {
      const message = err?.message || 'Failed to create an isolated worktree for this thread.';
      const failed: AgentThread = {
        id: threadId, sessionId, title: prompt.slice(0, 40), prompt, status: 'error',
        error: message,
        repoRoot, branchName, worktreePath: '', messages: [],
      };
      notify.error(message, 'Agent Thread');
      set((state) => ({ threads: { ...state.threads, [threadId]: failed }, order: [threadId, ...state.order], activeThreadId: threadId }));
      return;
    }

    const thread: AgentThread = {
      id: threadId, sessionId, title: prompt.slice(0, 40), prompt, status: 'starting',
      repoRoot, branchName, worktreePath, messages: [],
    };
    set((state) => ({ threads: { ...state.threads, [threadId]: thread }, order: [threadId, ...state.order], activeThreadId: threadId }));

    const update = (fn: (t: AgentThread) => AgentThread) => {
      set((state) => {
        const current = state.threads[threadId];
        if (!current) return state;
        return { threads: { ...state.threads, [threadId]: fn(current) } };
      });
    };

    const offChunk = api.onAgentChunk((sid, chunk) => {
      if (sid !== sessionId) return;
      update((t) => {
        const last = t.messages[t.messages.length - 1];
        if (last?.role === 'assistant') {
          const messages = [...t.messages];
          messages[messages.length - 1] = { ...last, text: last.text + chunk };
          return { ...t, messages };
        }
        return appendMessage(t, { role: 'assistant', text: chunk });
      });
    });
    const offToolCall = api.onAgentToolCall((sid, info) => {
      if (sid !== sessionId) return;
      update((t) => appendMessage(t, { role: 'tool', text: `${info.toolName}(${info.argsSummary})` }));
    });
    const offWorkingSet = api.onAgentWorkingSetUpdate((sid, changes) => {
      if (sid !== sessionId) return;
      // Thread worktrees are isolated from the main window's own agentWorkingSet — surface changed-file count on the thread itself rather than polluting the shared store.
      update((t) => ({ ...t, changedFileCount: changes.length }));
    });
    const offApproval = api.onAgentApprovalRequest((sid, request) => {
      if (sid !== sessionId) return;
      update((t) => appendMessage(t, { role: 'approval', text: '', approval: { requestId: request.requestId, toolName: request.toolName, argsSummary: request.argsSummary } }));
    });
    const offErr = api.onAgentErr((sid, message) => {
      if (sid !== sessionId) return;
      notify.error(message, 'Agent Thread');
      update((t) => ({ ...t, status: 'error', error: message }));
    });
    const offDone = api.onAgentDone((sid) => {
      if (sid !== sessionId) return;
      update((t) => (t.status === 'error' ? t : { ...t, status: 'done' }));
    });

    update((t) => ({ ...t, status: 'running' }));

    try {
      await api.queryAgent(useAgentStore.getState().activeAIProvider, useAgentStore.getState().activeAIModel, prompt, {
        workspacePath: worktreePath,
        workspaceFolders: [worktreePath],
        mode: 'agent',
        sessionId,
      });
    } catch (err: any) {
      // Guarded the same way as the status update below it — onAgentErr above may have
      // already reported (and toasted) this exact failure; avoid a duplicate toast for one error.
      if (get().threads[threadId]?.status !== 'error') {
        notify.error(err?.message || 'Thread failed.', 'Agent Thread');
      }
      update((t) => (t.status === 'error' ? t : { ...t, status: 'error', error: err?.message || 'Thread failed.' }));
    } finally {
      offChunk(); offToolCall(); offWorkingSet(); offApproval(); offErr(); offDone();
      // A thread that never produced any error/done event (e.g. stopped mid-stream) still needs a terminal status so the UI doesn't show a permanently spinning "running" badge.
      const current = get().threads[threadId];
      if (current && current.status === 'running') update((t) => ({ ...t, status: 'done' }));
    }
  },

  respondApproval: (threadId, requestId, approved) => {
    const api = window.api;
    api?.respondAgentApproval(requestId, approved);
    set((state) => {
      const thread = state.threads[threadId];
      if (!thread) return state;
      const messages = thread.messages.map((m) =>
        m.role === 'approval' && m.approval?.requestId === requestId
          ? { ...m, approval: { ...m.approval, resolved: approved ? ('approved' as const) : ('denied' as const) } }
          : m,
      );
      return { threads: { ...state.threads, [threadId]: { ...thread, messages } } };
    });
  },

  stopThread: (threadId) => {
    const thread = get().threads[threadId];
    if (!thread) return;
    window.api?.abortAI(thread.sessionId);
    set((state) => ({ threads: { ...state.threads, [threadId]: { ...thread, status: 'stopped' } } }));
  },

  discardThread: async (threadId) => {
    const thread = get().threads[threadId];
    if (!thread) return;
    window.api?.abortAI(thread.sessionId);
    if (thread.worktreePath) {
      await window.api?.gitRemoveWorktree(thread.repoRoot, thread.worktreePath).catch(() => {});
    }
    set((state) => {
      const { [threadId]: _removed, ...rest } = state.threads;
      return {
        threads: rest,
        order: state.order.filter((id) => id !== threadId),
        activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
      };
    });
  },
}));
