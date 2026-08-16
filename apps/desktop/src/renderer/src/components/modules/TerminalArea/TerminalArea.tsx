import React, { useEffect, useRef, useState } from 'react';
import './TerminalArea.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTerminalStore } from '../../../store/terminal';
import { useThemeStore } from '../../../store/theme';
import { useTerminalSettingsStore } from '../../../store/terminalSettings';
import { useFeatureFlagsStore } from '../../../store/featureFlags';
import { useAgentStore } from '../../../store/agent';
import { oneShotAIQuery } from '../../../utils/oneShotAIQuery';
import { isAIStreamBusy } from '../../../utils/aiStreamLock';
import { computeChromeBg } from '../../../utils/theme';
import { TerminalSessionsSidebar } from './TerminalSessionsSidebar';
import { TerminalAutocompleteDropdown } from './TerminalAutocompleteDropdown';
import { TerminalContextMenu } from './TerminalContextMenu';
import { TerminalHistoryPicker } from './TerminalHistoryPicker';
import { getRunCommandForFile } from './runFileCommand';
import { notify } from '../../../store/notifications';
import { useWorkspaceStore } from '../../../store/workspace';
import {
  getCompletionKind,
  getCurrentToken,
  splitPathToken,
  joinPath,
  resolveCdTarget,
  formatPathCandidates,
  computeCompletion,
} from '../../../utils/terminalAutocomplete';
import '@xterm/xterm/css/xterm.css';

// Fixed VS Code Dark+ ANSI palette; only background/foreground/cursor follow the active color theme.
const VSCODE_ANSI_COLORS = {
  black: '#000000',
  red: '#cd3131',
  green: '#0DBC79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

const readCssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const SAFETY_CHECK_PROMPT = (line: string) => `You are a terminal safety checker embedded in a code editor. Below is the exact text currently shown on a developer's terminal line, which may include a shell prompt prefix — ignore the prompt and judge only the command being run.

Respond in EXACTLY this format and nothing else:
SAFE
or
DANGEROUS: <one or two sentence explanation of what this command does and why it's risky>

A command is dangerous if it is destructive or hard/impossible to undo — e.g. deleting files or directories, force-pushing or rewriting git history, dropping/truncating database tables, formatting or wiping a drive, killing critical processes, revoking permissions. Ordinary commands (ls, cd, git status, npm install, running builds/tests, reading files) are NOT dangerous.

Terminal line: ${line}`;

/** Command-safety-gate UI state, rendered as a React overlay above xterm — never written into the buffer, since ConPTY desyncs if we inject lines locally. */
interface SafetyOverlayState {
  phase: 'checking' | 'confirm';
  explanation?: string;
  answer?: string;
}

const terminalThemes = [
  {
    name: 'Default Dark',
    foreground: '#e2e8f0',
    cursor: '#00ffcc',
  },
  {
    name: 'Matrix',
    foreground: '#00ff00',
    cursor: '#00ff00',
  },
  {
    name: 'Cyberpunk',
    foreground: '#00ffff',
    cursor: '#ff007f',
  },
  {
    name: 'Dracula',
    foreground: '#f8f8f2',
    cursor: '#50fa7b',
  },
  {
    name: 'Solarized Light',
    foreground: '#657b83',
    cursor: '#d33682',
  },
  {
    name: 'Monokai',
    foreground: '#f8f8f2',
    cursor: '#f92672',
  }
];

export const TerminalArea: React.FC = () => {
  const {
    terminals,
    activeTerminalId,
    closeTerminal,
    setActiveTerminal,
    renameTerminal,
  } = useTerminalStore();
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const {
    fontSize: terminalFontSize,
    cursorStyle: terminalCursorStyle,
    cursorBlink: terminalCursorBlink,
    scrollback: terminalScrollback,
  } = useTerminalSettingsStore();

  const terminalsRef = useRef<Map<string, { term: Terminal; fitAddon: FitAddon }>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // SAK Easter-egg color override, in-memory only; cleared the moment the IDE theme changes. null = no override.
  const sakOverrideRef = useRef<number | null>(null);
  // Last cols/rows we actually told the real pty about, per terminal — see
  // fitTerminal's comment for why this matters.
  const lastFitSizeRef = useRef<Map<string, { cols: number; rows: number }>>(new Map());
  // Timestamp of the last chunk of real pty output received per terminal —
  // see waitForQuiet below for why this exists.
  const lastOutputRef = useRef<Map<string, number>>(new Map());
  // Safety-gate overlay UI per terminal (null = no overlay). React state,
  // not a ref, because it drives rendering.
  const [safetyOverlays, setSafetyOverlays] = useState<Record<string, SafetyOverlayState | null>>({});
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [historyPicker, setHistoryPicker] = useState<'directory' | 'command' | null>(null);

  const setOverlay = (id: string, overlay: SafetyOverlayState | null) => {
    setSafetyOverlays((prev) => ({ ...prev, [id]: overlay }));
  };
  const statesRef = useRef<Map<string, {
    currentLine: string;
    isThemeSelectMode: boolean;
    // Set on any keystroke since last Enter/reset (incl. history recall); used only to skip the safety check on a genuinely bare Enter.
    hasInputSinceEnter: boolean;
    isCheckingSafety: boolean;
    pendingConfirmation: boolean;
    confirmAnswer: string;
    lastExplanation: string;
    // Authoritative dropdown open/highlight state, kept in a ref (not React state) since handleSegment needs synchronous per-keystroke reads.
    autocompleteMatches: string[];
    autocompleteHighlight: number;
    isFetchingCompletion: boolean;
  }>>(new Map());

  const getState = (id: string) => {
    if (!statesRef.current.has(id)) {
      statesRef.current.set(id, {
        currentLine: '',
        isThemeSelectMode: false,
        hasInputSinceEnter: false,
        isCheckingSafety: false,
        pendingConfirmation: false,
        confirmAnswer: '',
        lastExplanation: '',
        autocompleteMatches: [],
        autocompleteHighlight: 0,
        isFetchingCompletion: false,
      });
    }
    return statesRef.current.get(id)!;
  };

  // Per-terminal "known" cwd, best-effort approximated since there's no live shell-integration (OSC7) to ask the real pty for its cwd.
  const cwdRef = useRef<Map<string, string>>(new Map());
  // Directories/commands seen so far this session, most-recent-first, for the right-click "Go to Recent Directory"/"Run Recent Command" menu items — capped, deduped against their own most recent entry.
  const cwdHistoryRef = useRef<Map<string, string[]>>(new Map());
  const commandHistoryRef = useRef<Map<string, string[]>>(new Map());
  const HISTORY_CAP = 20;
  // PATH executable listing, fetched once across the app's lifetime and cached since PATH doesn't change during a session.
  const pathExecutablesRef = useRef<string[] | null>(null);
  const [autocompleteUi, setAutocompleteUi] = useState<Record<
    string,
    { matches: string[]; highlightIndex: number; position: { top: number; left: number } } | null
  >>({});

  // Guards against a hidden container (display: none), which would otherwise report 0 size and corrupt cols/rows with a bogus value.
  const fitTerminal = (id: string) => {
    const session = terminalsRef.current.get(id);
    const container = containersRef.current.get(id);
    if (!session || !container) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    try {
      session.fitAddon.fit();
      const { cols, rows } = session.term;

      // Only resize the pty when cols/rows actually changed — ConPTY redraws unconditionally on resize, causing duplicated output otherwise.
      const last = lastFitSizeRef.current.get(id);
      if (last && last.cols === cols && last.rows === rows) {
        return;
      }
      lastFitSizeRef.current.set(id, { cols, rows });

      const api = window.api;
      if (api && api.resizeTerminal) {
        api.resizeTerminal(id, cols, rows);
      }
    } catch (err) {
      console.error(`Fit error for terminal ${id}:`, err);
    }
  };

  // Safety-gate writes and real pty output land on the same terminal via independent paths; waiting for a quiet period avoids interleaving them.
  const waitForQuiet = (terminalId: string, quietMs = 120, maxWaitMs = 1200): Promise<void> => {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const last = lastOutputRef.current.get(terminalId) ?? 0;
        const sinceOutput = Date.now() - last;
        const sinceStart = Date.now() - start;
        if (sinceOutput >= quietMs || sinceStart >= maxWaitMs) {
          resolve();
        } else {
          setTimeout(check, 30);
        }
      };
      check();
    });
  };

  // Dropdown pixel position derived from xterm's character-cell coordinates (container size / cols/rows), not private xterm.js internals.
  const computeDropdownPosition = (id: string): { top: number; left: number } => {
    const session = terminalsRef.current.get(id);
    const container = containersRef.current.get(id);
    if (!session || !container) return { top: 0, left: 0 };
    const { term } = session;
    const rect = container.getBoundingClientRect();
    const cellWidth = term.cols > 0 ? rect.width / term.cols : 8;
    const cellHeight = term.rows > 0 ? rect.height / term.rows : 17;
    const { cursorX, cursorY } = term.buffer.active;
    return {
      left: rect.left + cursorX * cellWidth,
      top: rect.top + (cursorY + 1) * cellHeight,
    };
  };

  const openAutocompleteDropdown = (id: string, matches: string[]) => {
    const state = getState(id);
    state.autocompleteMatches = matches;
    state.autocompleteHighlight = 0;
    const position = computeDropdownPosition(id);
    setAutocompleteUi((prev) => ({ ...prev, [id]: { matches, highlightIndex: 0, position } }));
  };

  const closeAutocompleteDropdown = (id: string) => {
    const state = getState(id);
    if (state.autocompleteMatches.length === 0) return;
    state.autocompleteMatches = [];
    state.autocompleteHighlight = 0;
    setAutocompleteUi((prev) => (prev[id] ? { ...prev, [id]: null } : prev));
  };

  const moveAutocompleteHighlight = (id: string, delta: number) => {
    const state = getState(id);
    const n = state.autocompleteMatches.length;
    if (n === 0) return;
    state.autocompleteHighlight = (state.autocompleteHighlight + delta + n) % n;
    const highlightIndex = state.autocompleteHighlight;
    setAutocompleteUi((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, highlightIndex } } : prev));
  };

  // Sends the remainder of the highlighted match through the real pty (never writes into xterm's buffer directly) and mirrors it into currentLine.
  const acceptAutocompleteDropdown = (id: string) => {
    const state = getState(id);
    if (state.autocompleteMatches.length === 0) return;
    const chosen = state.autocompleteMatches[state.autocompleteHighlight];
    const partial = getCurrentToken(state.currentLine);
    const suffix = chosen.slice(partial.length);
    if (suffix) {
      window.api?.writeTerminal?.(id, suffix);
      state.currentLine += suffix;
      state.hasInputSinceEnter = true;
    }
    closeAutocompleteDropdown(id);
  };

  // Best-effort cwd tracking, called with the just-submitted command line from both of handleSegment's two Enter paths.
  const trackCwdIfCdCommand = (id: string, line: string) => {
    const current = cwdRef.current.get(id) ?? useWorkspaceStore.getState().workspacePath ?? '.';
    const next = resolveCdTarget(current, line.trim());
    if (next !== current) {
      cwdRef.current.set(id, next);
      const history = cwdHistoryRef.current.get(id) ?? [];
      if (history[0] !== next) {
        cwdHistoryRef.current.set(id, [next, ...history.filter((d) => d !== next)].slice(0, HISTORY_CAP));
      }
    }
  };

  // Records every submitted (non-empty) command line for the "Run Recent Command" context-menu item — same call sites as trackCwdIfCdCommand above.
  const recordCommandHistory = (id: string, line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const history = commandHistoryRef.current.get(id) ?? [];
    if (history[0] === trimmed) return;
    commandHistoryRef.current.set(id, [trimmed, ...history.filter((c) => c !== trimmed)].slice(0, HISTORY_CAP));
  };

  const triggerAutocomplete = async (id: string) => {
    const state = getState(id);
    if (state.isFetchingCompletion) return;
    state.isFetchingCompletion = true;
    try {
      const line = state.currentLine;
      const kind = getCompletionKind(line);
      const token = getCurrentToken(line);

      let candidates: string[] = [];
      let namePartial = token;

      if (kind === 'command') {
        if (pathExecutablesRef.current === null) {
          pathExecutablesRef.current = (await window.api?.getPathExecutables?.()) ?? [];
        }
        candidates = pathExecutablesRef.current;
      } else {
        const { dirPart, namePart } = splitPathToken(token);
        namePartial = namePart;
        const cwd = cwdRef.current.get(id) ?? useWorkspaceStore.getState().workspacePath ?? '.';
        const targetDir = joinPath(cwd, dirPart);
        try {
          const entries = (await window.api?.readDir?.(targetDir)) ?? [];
          candidates = formatPathCandidates(entries);
        } catch {
          candidates = [];
        }
      }

      // Bail if the line changed while the IPC call above was in flight — stale suggestions would be wrong to apply.
      if (getState(id).currentLine !== line) return;

      const { matches, suffixToSend } = computeCompletion(candidates, namePartial);

      if (matches.length === 0) {
        // No opinion — let the shell's own native Tab behavior (if any) run.
        window.api?.writeTerminal?.(id, '\t');
        return;
      }

      if (suffixToSend) {
        window.api?.writeTerminal?.(id, suffixToSend);
        state.currentLine += suffixToSend;
        state.hasInputSinceEnter = true;
      }

      if (matches.length > 1) {
        openAutocompleteDropdown(id, matches);
      }
    } finally {
      state.isFetchingCompletion = false;
    }
  };

  // Background always follows the IDE theme; foreground/cursor use the active SAK preset if set, else also follow the IDE theme.
  const applyThemeToTerminal = (term: Terminal) => {
    const sakIndex = sakOverrideRef.current;
    const sakTheme = sakIndex !== null ? terminalThemes[sakIndex] : null;

    const chromeBg = computeChromeBg(readCssVar('--bg-primary'));
    const accentCyan = readCssVar('--accent-cyan');

    term.options.theme = {
      background: chromeBg,
      foreground: sakTheme?.foreground ?? readCssVar('--text-primary'),
      cursor: sakTheme?.cursor ?? accentCyan,
      cursorAccent: chromeBg,
      selectionBackground: hexToRgba(accentCyan, 0.3),
      ...VSCODE_ANSI_COLORS,
    };
  };

  // 1. Subscribe to terminal output event once
  useEffect(() => {
    const api = window.api;
    if (api && api.onTerminalOutput) {
      const unsubscribe = api.onTerminalOutput((eventData: { terminalId: string; data: string }) => {
        const { terminalId, data } = eventData;
        lastOutputRef.current.set(terminalId, Date.now());
        const session = terminalsRef.current.get(terminalId);
        if (session) {
          session.term.write(data);
        }
      });
      return unsubscribe;
    }
    return undefined;
  }, []);

  // 2. Focus and fit active terminal when tab changes
  useEffect(() => {
    if (!activeTerminalId) return;
    const active = terminalsRef.current.get(activeTerminalId);
    if (active) {
      setTimeout(() => {
        fitTerminal(activeTerminalId);
        // Don't steal focus from an in-progress terminal rename — a row click can be the first half of a double-click-to-rename.
        const active_el = document.activeElement;
        const isRenamingTerminal = active_el instanceof HTMLElement && active_el.classList.contains('sde-terminal-session-rename-input');
        if (isRenamingTerminal) return;
        try {
          active.term.focus();
        } catch (err) {
          console.error('Focus error:', err);
        }
      }, 50);
    }
  }, [activeTerminalId]);

  // 2b. Refit on any viewport size change (panel toggles, splitter drags, etc), not just OS window resize — ResizeObserver covers all cases.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      if (activeTerminalId) fitTerminal(activeTerminalId);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeTerminalId]);

  // 2c. Re-derive terminal colors from the IDE theme on change, dropping any active SAK override since it's only temporary.
  useEffect(() => {
    sakOverrideRef.current = null;
    for (const { term } of terminalsRef.current.values()) {
      applyThemeToTerminal(term);
    }
  }, [currentTheme]);

  // 2d. Live-apply font/cursor/scrollback settings by mutating `.options` directly; re-fit after since font size shifts cell size.
  useEffect(() => {
    for (const { term } of terminalsRef.current.values()) {
      term.options.fontSize = terminalFontSize;
      term.options.cursorStyle = terminalCursorStyle;
      term.options.cursorBlink = terminalCursorBlink;
      term.options.scrollback = terminalScrollback;
    }
    if (activeTerminalId) fitTerminal(activeTerminalId);
  }, [terminalFontSize, terminalCursorStyle, terminalCursorBlink, terminalScrollback]);

  // 3. Keep terminals array in sync with xterm instances
  useEffect(() => {
    const api = window.api;
    if (!api) return;

    // Clean up removed terminals
    for (const [id, { term }] of terminalsRef.current.entries()) {
      if (!terminals.some((t) => t.id === id)) {
        term.dispose();
        terminalsRef.current.delete(id);
        statesRef.current.delete(id);
        lastFitSizeRef.current.delete(id);
        lastOutputRef.current.delete(id);
        cwdRef.current.delete(id);
        cwdHistoryRef.current.delete(id);
        commandHistoryRef.current.delete(id);
        setSafetyOverlays((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAutocompleteUi((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    // Initialize new terminals
    terminals.forEach((t) => {
      if (terminalsRef.current.has(t.id)) return;

      const container = containersRef.current.get(t.id);
      if (!container) return;

      // Theme is set below via applyThemeToTerminal(term) right after open(); other options match VS Code's real terminal defaults.
      const term = new Terminal({
        fontFamily: 'var(--font-mono)',
        fontSize: terminalFontSize,
        lineHeight: 1.1,
        cursorBlink: terminalCursorBlink,
        cursorStyle: terminalCursorStyle,
        scrollback: terminalScrollback,
        allowProposedApi: true,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(container);
      applyThemeToTerminal(term);

      // Allow global shortcuts to propagate to the window
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown') {
          const key = e.key;
          const ctrlOrMeta = e.ctrlKey || e.metaKey;
          if (ctrlOrMeta) {
            if (
              key === '`' ||
              key === '~' ||
              key === 'p' ||
              key === 'P' ||
              key === 'w' ||
              key === 'W'
            ) {
              return false; // Bubble up to main window
            }
          }
        }
        return true;
      });

      terminalsRef.current.set(t.id, { term, fitAddon });

      // Delayed a tick rather than fitting synchronously, which can race ahead of the browser's layout pass and measure a stale size.
      if (t.id === activeTerminalId) {
        setTimeout(() => fitTerminal(t.id), 50);
      }

      // Handles one logical keystroke/segment; a pasted block can deliver several \r-terminated lines in one onData call (see split below).
      const handleSegment = (segment: string) => {
        const state = getState(t.id);

        if (state.isThemeSelectMode) {
          if (segment === '\x1b') { // Escape key
            term.write('\r\nCancelled.\r\n');
            state.isThemeSelectMode = false;
            if (api && api.writeTerminal) {
              api.writeTerminal(t.id, '\r');
            }
          } else {
            const num = parseInt(segment, 10);
            if (!isNaN(num) && num >= 1 && num <= terminalThemes.length) {
              const selected = terminalThemes[num - 1];
              sakOverrideRef.current = num - 1;

              // Update all terminal instances options to apply selected colors
              for (const { term: anyTerm } of terminalsRef.current.values()) {
                applyThemeToTerminal(anyTerm);
              }

              term.write(`\r\nTheme changed to ${selected.name}!\r\n`);
              state.isThemeSelectMode = false;
              if (api && api.writeTerminal) {
                api.writeTerminal(t.id, '\r');
              }
            } else {
              term.write('\r\nInvalid selection. Choose 1-6 or press Esc: ');
            }
          }
          return;
        }

        // A safety check for the previous Enter is still in flight — swallow
        // further input rather than risk forwarding a keystroke mid-decision.
        if (state.isCheckingSafety) {
          return;
        }

        // Awaiting a y/n answer: keystrokes are captured here and echoed into the OVERLAY, never the pty-driven terminal buffer.
        if (state.pendingConfirmation) {
          if (segment === '\r') {
            const answer = state.confirmAnswer.trim().toLowerCase();
            state.pendingConfirmation = false;
            state.confirmAnswer = '';
            setOverlay(t.id, null);
            if (answer === 'y' || answer === 'yes') {
              // The original command is still sitting untouched in the
              // shell's own line buffer — just submit it.
              if (api && api.writeTerminal) api.writeTerminal(t.id, '\r');
            } else {
              clearPendingShellLine(t.id);
            }
          } else if (segment === '\x1b' || segment === '\x03') { // Escape or Ctrl+C
            state.pendingConfirmation = false;
            state.confirmAnswer = '';
            setOverlay(t.id, null);
            clearPendingShellLine(t.id);
          } else if (segment === '\x7f' || segment === '\b') {
            if (state.confirmAnswer.length > 0) {
              state.confirmAnswer = state.confirmAnswer.slice(0, -1);
              setOverlay(t.id, { phase: 'confirm', explanation: state.lastExplanation, answer: state.confirmAnswer });
            }
          } else if (segment.length === 1 && segment.charCodeAt(0) >= 32 && segment.charCodeAt(0) <= 126) {
            state.confirmAnswer += segment;
            setOverlay(t.id, { phase: 'confirm', explanation: state.lastExplanation, answer: state.confirmAnswer });
          }
          return;
        }

        // Dropdown open: Tab/Down cycle forward, Up cycles back, Enter/Tab accepts (fills, doesn't submit), Escape or any other key dismisses.
        if (state.autocompleteMatches.length > 0) {
          if (segment === '\t' || segment === '\x1b[B') {
            moveAutocompleteHighlight(t.id, 1);
            return;
          }
          if (segment === '\x1b[A') {
            moveAutocompleteHighlight(t.id, -1);
            return;
          }
          if (segment === '\r') {
            acceptAutocompleteDropdown(t.id);
            return;
          }
          if (segment === '\x1b') {
            closeAutocompleteDropdown(t.id);
            return;
          }
          closeAutocompleteDropdown(t.id);
        }

        if (segment === '\t') {
          triggerAutocomplete(t.id);
          return;
        }

        // Normal mode command tracking
        if (segment === '\r') {
          if (state.currentLine.trim().toUpperCase() === 'SAK') {
            // Intercept and erase 'SAK' from PTY buffer
            if (api && api.writeTerminal) {
              const backspaces = '\b'.repeat(state.currentLine.length);
              api.writeTerminal(t.id, backspaces);
            }
            // Display theme selection menu after PTY erases SAK
            setTimeout(() => {
              term.write('\r\n\r\n--- Terminal Color Themes ---\r\n');
              terminalThemes.forEach((th, i) => {
                term.write(`${i + 1}. ${th.name}\r\n`);
              });
              term.write('Select a theme (1-6) or press Esc: ');
              state.isThemeSelectMode = true;
            }, 100);
            state.currentLine = '';
            state.hasInputSinceEnter = false;
            return;
          }

          const guardEnabled = useFeatureFlagsStore.getState().isFlagEnabled('command-safety-gate');

          if (guardEnabled && state.hasInputSinceEnter && !isAIStreamBusy()) {
            state.currentLine = '';
            state.hasInputSinceEnter = false;
            state.isCheckingSafety = true;

            setOverlay(t.id, { phase: 'checking' });

            (async () => {
              // Wait until the terminal goes quiet before reading — shell echo or a previous prompt may still be arriving over IPC.
              await waitForQuiet(t.id);

              const commandRow = term.buffer.active.baseY + term.buffer.active.cursorY;
              const line = term.buffer.active.getLine(commandRow)?.translateToString(true) ?? '';
              trackCwdIfCdCommand(t.id, line);
              recordCommandHistory(t.id, line);

              try {
                const { activeAIProvider, activeAIModel } = useAgentStore.getState();
                const response = await oneShotAIQuery(activeAIProvider, activeAIModel, SAFETY_CHECK_PROMPT(line));
                const trimmed = response.trim();
                if (trimmed.toUpperCase().startsWith('DANGEROUS')) {
                  const explanation = trimmed.slice(trimmed.indexOf(':') + 1).trim() || 'This command may be destructive.';
                  state.lastExplanation = explanation;
                  state.pendingConfirmation = true;
                  setOverlay(t.id, { phase: 'confirm', explanation, answer: '' });
                } else {
                  setOverlay(t.id, null);
                  if (api && api.writeTerminal) api.writeTerminal(t.id, '\r');
                }
              } catch (err) {
                // Fail open — a broken/unconfigured AI provider must never
                // lock the user out of their own terminal.
                console.error('Command safety check failed, running command normally:', err);
                setOverlay(t.id, null);
                if (api && api.writeTerminal) api.writeTerminal(t.id, '\r');
              } finally {
                state.isCheckingSafety = false;
              }
            })();
            return;
          }

          trackCwdIfCdCommand(t.id, state.currentLine);
          recordCommandHistory(t.id, state.currentLine);
          currentLineReset(t.id);
          state.hasInputSinceEnter = false;
        } else if (segment === '\x7f' || segment === '\b') {
          state.currentLine = state.currentLine.slice(0, -1);
          state.hasInputSinceEnter = true;
        } else {
          // Track printable characters
          if (segment.length === 1 && segment.charCodeAt(0) >= 32 && segment.charCodeAt(0) <= 126) {
            state.currentLine += segment;
          }
          state.hasInputSinceEnter = true;
        }

        // Forward raw input to correct PTY session
        if (api && api.writeTerminal) {
          api.writeTerminal(t.id, segment);
        }
      };

      // A pasted block can deliver multiple lines in one onData call; split on embedded \r so each line still gets Enter-detection.
      term.onData((data) => {
        const segments = data.split(/(\r)/).filter((s) => s !== '');
        for (const segment of segments) {
          handleSegment(segment);
        }
      });
    });

    const currentLineReset = (id: string) => {
      const state = getState(id);
      state.currentLine = '';
    };

    // Clears the shell's unsubmitted input line on cancel; Ctrl+U works on bash/zsh but not PowerShell, which needs Escape instead.
    const clearPendingShellLine = (id: string) => {
      if (api && api.writeTerminal) {
        api.writeTerminal(id, api.platform === 'win32' ? '\x1b' : '\x15');
      }
    };

    const handleResize = () => {
      if (activeTerminalId) fitTerminal(activeTerminalId);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [terminals, activeTerminalId]);

  // 4. Dispose of all terminals on component unmount
  useEffect(() => {
    return () => {
      for (const { term } of terminalsRef.current.values()) {
        term.dispose();
      }
      terminalsRef.current.clear();
      statesRef.current.clear();
    };
  }, []);

  const activeOverlay = activeTerminalId ? safetyOverlays[activeTerminalId] : null;
  const activeAutocomplete = activeTerminalId ? autocompleteUi[activeTerminalId] : null;

  const handleTerminalContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!activeTerminalId) return;
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const sendToActiveTerminal = (text: string) => {
    if (!activeTerminalId) return;
    window.api?.writeTerminal?.(activeTerminalId, `${text}\r`);
  };

  const handleClearTerminal = () => {
    if (!activeTerminalId) return;
    terminalsRef.current.get(activeTerminalId)?.term.clear();
  };

  const handleRunSelectedText = () => {
    const { activeEditorInstance } = useWorkspaceStore.getState();
    const selection = activeEditorInstance?.getSelection?.();
    const text = selection ? activeEditorInstance.getModel()?.getValueInRange(selection) : '';
    if (!text?.trim()) {
      notify.warning('No text is selected in the editor.', 'Run Selected Text');
      return;
    }
    sendToActiveTerminal(text);
  };

  const handleRunActiveFile = () => {
    const { activeTabPath } = useWorkspaceStore.getState();
    if (!activeTabPath) return;
    const command = getRunCommandForFile(activeTabPath);
    if (!command) {
      notify.warning(`No run command is configured for this file type (${activeTabPath.split('.').pop()}).`, 'Run Active File');
      return;
    }
    sendToActiveTerminal(command);
  };

  const activeCwdHistory = activeTerminalId ? cwdHistoryRef.current.get(activeTerminalId) ?? [] : [];
  const activeCommandHistory = activeTerminalId ? commandHistoryRef.current.get(activeTerminalId) ?? [] : [];
  const editorSelection = contextMenuPos ? useWorkspaceStore.getState().activeEditorInstance?.getSelection?.() : null;
  const hasEditorSelection = !!editorSelection && !editorSelection.isEmpty();
  const hasActiveFile = contextMenuPos ? !!useWorkspaceStore.getState().activeTabPath : false;

  return (
    <div className="sde-terminal-area">
      <div className="sde-terminal-viewport" ref={viewportRef} onContextMenu={handleTerminalContextMenu}>
        {terminals.map((t) => (
          <div
            key={t.id}
            ref={(el) => {
              if (el) {
                containersRef.current.set(t.id, el);
              } else {
                containersRef.current.delete(t.id);
              }
            }}
            className={`sde-terminal-instance${t.id === activeTerminalId ? '' : ' sde-terminal-instance--hidden'}`}
          />
        ))}

        {/* Command-safety-gate overlay — rendered above the buffer, never
            written into it (see SafetyOverlayState). */}
        {activeOverlay && (
          <div className="sde-terminal-safety-overlay">
            {activeOverlay.phase === 'checking' ? (
              <span className="sde-terminal-safety-checking">⏳ Checking command safety…</span>
            ) : (
              <div className="sde-terminal-safety-confirm">
                <div className="sde-terminal-safety-title">⚠ Potentially dangerous command</div>
                <div className="sde-terminal-safety-explanation">{activeOverlay.explanation}</div>
                <div className="sde-terminal-safety-hint">
                  Type <b>y</b> and press Enter to run it anyway — Enter alone or Esc cancels.
                  {activeOverlay.answer ? <span className="sde-terminal-safety-answer"> {activeOverlay.answer}</span> : null}
                </div>
              </div>
            )}
          </div>
        )}

        {/* position:fixed with viewport-relative coordinates, so its DOM placement here doesn't matter for where it visually lands. */}
        {activeAutocomplete && activeTerminalId && (
          <TerminalAutocompleteDropdown
            suggestions={activeAutocomplete.matches}
            highlightIndex={activeAutocomplete.highlightIndex}
            position={activeAutocomplete.position}
            onSelect={(index) => {
              const state = getState(activeTerminalId);
              state.autocompleteHighlight = index;
              acceptAutocompleteDropdown(activeTerminalId);
            }}
          />
        )}
      </div>

      {contextMenuPos && activeTerminalId && (
        <TerminalContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          onClose={() => setContextMenuPos(null)}
          onClear={handleClearTerminal}
          onRunSelectedText={handleRunSelectedText}
          onRunActiveFile={handleRunActiveFile}
          onGoToRecentDirectory={() => setHistoryPicker('directory')}
          onRunRecentCommand={() => setHistoryPicker('command')}
          hasSelection={hasEditorSelection}
          hasActiveFile={hasActiveFile}
          hasCwdHistory={activeCwdHistory.length > 0}
          hasCommandHistory={activeCommandHistory.length > 0}
        />
      )}

      {historyPicker === 'directory' && (
        <TerminalHistoryPicker
          title="Go to Recent Directory"
          items={activeCwdHistory}
          onSelect={(dir) => sendToActiveTerminal(`cd "${dir}"`)}
          onClose={() => setHistoryPicker(null)}
        />
      )}
      {historyPicker === 'command' && (
        <TerminalHistoryPicker
          title="Run Recent Command"
          items={activeCommandHistory}
          onSelect={(command) => sendToActiveTerminal(command)}
          onClose={() => setHistoryPicker(null)}
        />
      )}

      {/* VS Code-style session list, sidebar to the right — only shown once
          there's more than one terminal to switch between */}
      {terminals.length > 1 && (
        <TerminalSessionsSidebar
          terminals={terminals}
          activeTerminalId={activeTerminalId}
          setActiveTerminal={setActiveTerminal}
          closeTerminal={closeTerminal}
          renameTerminal={renameTerminal}
        />
      )}
    </div>
  );
};
