/** Wire format between an extension and the host; shaped as if it already had to cross a real IPC channel so swapping the same-process transport later needs no redesign. */

/** Extension → host: "I'm registering a contribution." Payload shape is entirely kind-specific and opaque here. */
export interface RegisterMessage {
  type: 'register';
  kind: string;
  payload: unknown;
}

/** Host → extension: "call the callback you registered under this ID, with these arguments." */
export interface InvokeMessage {
  type: 'invoke';
  requestId: string;
  callbackId: string;
  args: unknown[];
}

/** Extension → host: one incremental chunk of a streaming invocation's output (e.g. an AI provider's streamed tokens). */
export interface InvokeChunkMessage {
  type: 'invokeChunk';
  requestId: string;
  chunk: unknown;
}

/** Extension → host: the final outcome of an invoke — exactly one of `result`/`error` is set. */
export interface InvokeResultMessage {
  type: 'invokeResult';
  requestId: string;
  result?: unknown;
  error?: string;
}

export type ExtensionHostMessage = RegisterMessage | InvokeMessage | InvokeChunkMessage | InvokeResultMessage;
