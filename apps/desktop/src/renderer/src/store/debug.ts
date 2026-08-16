import { create } from 'zustand';
import type { DapConnection } from '../debug/dapConnection';
import { notify } from './notifications';

export type DebugSessionStatus = 'starting' | 'running' | 'paused' | 'terminated' | 'error';

export interface DapStackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: { path?: string; name?: string };
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface DapVariableScope {
  scopeName: string;
  variables: DapVariable[];
}

export interface DebugConsoleLine {
  category: string;
  text: string;
}

export interface DebugSession {
  sessionId: string;
  filePath: string;
  status: DebugSessionStatus;
  error?: string;
  connection: DapConnection;
  callStack: DapStackFrame[];
  variableScopes: DapVariableScope[];
  console: DebugConsoleLine[];
}

interface DebugState {
  sessions: Record<string, DebugSession>;
  activeSessionId: string | null;
  /** Line numbers are 1-indexed, matching Monaco. */
  breakpoints: Record<string, number[]>;

  registerSession: (sessionId: string, filePath: string, connection: DapConnection) => void;
  setSessionStatus: (sessionId: string, status: DebugSessionStatus, error?: string) => void;
  setCallStack: (sessionId: string, frames: DapStackFrame[]) => void;
  setVariables: (sessionId: string, scopes: DapVariableScope[]) => void;
  appendConsole: (sessionId: string, category: string, text: string) => void;
  removeSession: (sessionId: string) => void;

  toggleBreakpoint: (filePath: string, line: number) => void;
  getBreakpoints: (filePath: string) => number[];
}

export const useDebugStore = create<DebugState>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  breakpoints: {},

  registerSession: (sessionId, filePath, connection) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { sessionId, filePath, status: 'starting', connection, callStack: [], variableScopes: [], console: [] },
      },
      activeSessionId: sessionId,
    }));
  },

  setSessionStatus: (sessionId, status, error) => {
    // The status dot + inline "Terminated: <reason>" text (DebugPanel.tsx) is the right home
    // for ongoing session state; the toast is just for the moment it actually happens, since
    // that's easy to miss if the Debug panel isn't the active bottom-panel tab right now.
    if (status === 'error' && error) notify.error(error, 'Debugger');
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, status, error } } };
    });
  },

  setCallStack: (sessionId, frames) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, callStack: frames } } };
    });
  },

  setVariables: (sessionId, scopes) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, variableScopes: scopes } } };
    });
  },

  appendConsole: (sessionId, category, text) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      // Cap at 2000 lines so a chatty debuggee can't grow this unboundedly.
      const console = [...session.console, { category, text }].slice(-2000);
      return { sessions: { ...state.sessions, [sessionId]: { ...session, console } } };
    });
  },

  removeSession: (sessionId) => {
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.sessions;
      return {
        sessions: rest,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      };
    });
  },

  toggleBreakpoint: (filePath, line) => {
    set((state) => {
      const existing = state.breakpoints[filePath] ?? [];
      const next = existing.includes(line) ? existing.filter((l) => l !== line) : [...existing, line].sort((a, b) => a - b);
      return { breakpoints: { ...state.breakpoints, [filePath]: next } };
    });
  },

  getBreakpoints: (filePath) => get().breakpoints[filePath] ?? [],
}));
