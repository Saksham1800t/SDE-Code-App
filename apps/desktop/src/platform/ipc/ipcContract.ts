/** The shape every per-domain IPC contract must satisfy: a map of channel name to the function signature both sides are checked against. */
export type IpcContract = Record<string, (...args: any[]) => Promise<unknown> | void>;
