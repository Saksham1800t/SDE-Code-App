import { Disposable, generateId } from '../../kernel';
import { IExtensionTransport } from './transport';
import { ExtensionHostMessage } from './messages';

type PlainCallback = (...args: unknown[]) => unknown;
type StreamingCallback = (onChunk: (chunk: unknown) => void, ...args: unknown[]) => unknown;

/** The extension side of the RPC; holds extension authors' real callback functions, only opaque IDs for them cross the transport. */
export class RpcExtensionSide extends Disposable {
  private readonly plainCallbacks = new Map<string, PlainCallback>();
  private readonly streamingCallbacks = new Map<string, StreamingCallback>();

  constructor(private readonly transport: IExtensionTransport) {
    super();
    this._register(this.transport.onMessage((message) => this.handleMessage(message)));
  }

  /** Sends a registration message to the host. `payload` is entirely kind-specific. */
  register(kind: string, payload: unknown): void {
    this.transport.send({ type: 'register', kind, payload });
  }

  /** Registers a plain callback and returns the ID to reference it by in a register() payload. */
  registerCallback(fn: PlainCallback): string {
    const id = generateId();
    this.plainCallbacks.set(id, fn);
    return id;
  }

  /** Registers a streaming callback; `fn` receives an `onChunk` sink as its first argument, called as needed before its return value becomes the final result. */
  registerStreamingCallback(fn: StreamingCallback): string {
    const id = generateId();
    this.streamingCallbacks.set(id, fn);
    return id;
  }

  private async handleMessage(message: ExtensionHostMessage): Promise<void> {
    if (message.type !== 'invoke') return;

    const plain = this.plainCallbacks.get(message.callbackId);
    if (plain) {
      try {
        const result = await plain(...message.args);
        this.transport.send({ type: 'invokeResult', requestId: message.requestId, result });
      } catch (err) {
        this.transport.send({ type: 'invokeResult', requestId: message.requestId, error: toErrorMessage(err) });
      }
      return;
    }

    const streaming = this.streamingCallbacks.get(message.callbackId);
    if (streaming) {
      try {
        const onChunk = (chunk: unknown) => this.transport.send({ type: 'invokeChunk', requestId: message.requestId, chunk });
        const result = await streaming(onChunk, ...message.args);
        this.transport.send({ type: 'invokeResult', requestId: message.requestId, result });
      } catch (err) {
        this.transport.send({ type: 'invokeResult', requestId: message.requestId, error: toErrorMessage(err) });
      }
      return;
    }

    this.transport.send({
      type: 'invokeResult',
      requestId: message.requestId,
      error: `Unknown callback ID: ${message.callbackId}`,
    });
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
