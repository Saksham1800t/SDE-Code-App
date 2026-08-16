import type { DapMessage, DapMessageEvent } from '@sde-code/protocol';

type EventHandler = (body: any) => void;

/**
 * One DAP session's request/response + event dispatch, over the
 * dapSend/onDapMessage IPC pair main relays blindly (see DapService's doc
 * comment). Deliberately hand-rolled rather than reusing vscode-jsonrpc
 * (lspTransport.ts's approach for LSP) — DAP messages are `{seq, type,
 * command|event, ...}`, not JSON-RPC 2.0, so vscode-jsonrpc's request/response
 * correlation doesn't apply here.
 */
export class DapConnection {
  private nextSeq = 1;
  private pending = new Map<number, { resolve: (body: any) => void; reject: (err: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private unlisten: (() => void) | null = null;

  constructor(private readonly sessionId: string) {}

  listen(): void {
    this.unlisten = window.api.onDapMessage((event: DapMessageEvent) => {
      if (event.sessionId !== this.sessionId) return;
      this.handleMessage(event.message);
    });
  }

  private handleMessage(message: DapMessage): void {
    if (message.type === 'response' && message.request_seq !== undefined) {
      const pending = this.pending.get(message.request_seq);
      if (!pending) return;
      this.pending.delete(message.request_seq);
      clearTimeout(pending.timeout);
      if (message.success) pending.resolve(message.body);
      else pending.reject(new Error(message.message || `DAP request "${message.command}" failed.`));
      return;
    }
    if (message.type === 'event' && message.event) {
      const handlers = this.eventHandlers.get(message.event);
      handlers?.forEach((h) => h(message.body));
    }
  }

  sendRequest<T = any>(command: string, args?: unknown, timeoutMs = 15000): Promise<T> {
    const seq = this.nextSeq++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP request "${command}" timed out.`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timeout });
      window.api.dapSend(this.sessionId, { seq, type: 'request', command, arguments: args } as DapMessage);
    });
  }

  /** Returns an unsubscribe function. Multiple handlers per event are allowed (e.g. console output + a future watch-expression refresh both listening to 'stopped'). */
  onEvent(eventName: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(eventName)) this.eventHandlers.set(eventName, new Set());
    this.eventHandlers.get(eventName)!.add(handler);
    return () => this.eventHandlers.get(eventName)?.delete(handler);
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(new Error('Debug session disposed.'));
    }
    this.pending.clear();
    this.eventHandlers.clear();
  }
}
