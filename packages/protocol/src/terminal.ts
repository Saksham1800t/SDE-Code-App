/** The only `terminal:*` channel needing a return value — the rest (create/write/resize/close, output) stay on the untyped push pattern. */
export type TerminalIpcContract = {
  /** Every PATH executable name, deduped and cached for the process lifetime; backs the terminal's command-name Tab completion. */
  'terminal:getPathExecutables': () => Promise<string[]>;
};
