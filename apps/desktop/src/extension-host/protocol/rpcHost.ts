import { Disposable, generateId } from '../../kernel';
import { IExtensionTransport } from './transport';
import { ExtensionHostMessage } from './messages';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onChunk?: (chunk: unknown) => void;
}

/** The host side of the RPC: routes `register` messages to the per-kind registry without knowing what the `kind` means, and lets the host invoke previously-registered extension callbacks by ID. */
export class RpcHost extends Disposable {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly transport: IExtensionTransport,
    private readonly onRegister: (kind: string, payload: unknown) => void,
  ) {
    super();
    this._register(this.transport.onMessage((message) => this.handleMessage(message)));
  }

  /** Invokes a previously-registered extension-side callback, awaiting a single result. */
  invoke<T = unknown>(callbackId: string, args: unknown[]): Promise<T> {
    const requestId = generateId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      this.transport.send({ type: 'invoke', requestId, callbackId, args });
    });
  }

  /** Invokes a streaming callback; `onChunk` fires for each chunk before the returned promise settles. */
  invokeStreaming(callbackId: string, args: unknown[], onChunk: (chunk: unknown) => void): Promise<void> {
    const requestId = generateId();
    return new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve: () => resolve(), reject, onChunk });
      this.transport.send({ type: 'invoke', requestId, callbackId, args });
    });
  }

  private handleMessage(message: ExtensionHostMessage): void {
    switch (message.type) {
      case 'register':
        this.onRegister(message.kind, message.payload);
        return;
      case 'invokeChunk': {
        this.pending.get(message.requestId)?.onChunk?.(message.chunk);
        return;
      }
      case 'invokeResult': {
        const request = this.pending.get(message.requestId);
        if (!request) return;
        this.pending.delete(message.requestId);
        if (message.error !== undefined) {
          request.reject(new Error(message.error));
        } else {
          request.resolve(message.result);
        }
        return;
      }
      case 'invoke':
        // Only the host invokes extension-side callbacks in v1; the reverse direction isn't needed yet.
        return;
    }
  }

  dispose(): void {
    for (const request of this.pending.values()) {
      request.reject(new Error('Extension host transport disposed while a request was in flight.'));
    }
    this.pending.clear();
    super.dispose();
  }
}
