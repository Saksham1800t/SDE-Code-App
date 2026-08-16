// The /browser subpath (not the bare package) matters here — it installs
// vscode-jsonrpc's Runtime Abstraction Layer as an import side-effect.
// createMessageConnection throws "No runtime abstraction layer installed"
// without it, even though this file never uses any of the browser-specific
// classes (BrowserMessageReader/Writer) it also exports.
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
  type DataCallback,
  type Disposable,
  type Message,
  type MessageConnection,
} from 'vscode-jsonrpc/browser';
import type { LspMessageEvent, LspRpcMessage } from '@sde-code/protocol';

// Bridges vscode-jsonrpc's MessageReader/Writer interfaces onto the
// lsp:send / lsp:message IPC pair — main only relays already-framed,
// already-parsed JSON-RPC objects (see LspService's doc comment), so no
// Content-Length parsing happens here; this is a pure pass-through.
class IpcMessageReader extends AbstractMessageReader {
  private offListener: (() => void) | null = null;

  constructor(private readonly language: string, private readonly workspaceRoot: string) {
    super();
  }

  listen(callback: DataCallback): Disposable {
    this.offListener = window.api.onLspMessage((event: LspMessageEvent) => {
      if (event.language !== this.language || event.workspaceRoot !== this.workspaceRoot) return;
      callback(event.message as unknown as Message);
    });
    return { dispose: () => { this.offListener?.(); this.offListener = null; } };
  }

  dispose(): void {
    this.offListener?.();
    this.offListener = null;
    super.dispose();
  }
}

class IpcMessageWriter extends AbstractMessageWriter {
  constructor(private readonly language: string, private readonly workspaceRoot: string) {
    super();
  }

  write(msg: Message): Promise<void> {
    try {
      window.api.lspSend(this.language, this.workspaceRoot, msg as unknown as LspRpcMessage);
      return Promise.resolve();
    } catch (err: any) {
      this.fireError(err, msg, 1);
      return Promise.reject(err);
    }
  }

  end(): void {}
}

/** One connection per (language, workspace root) — call ensureServer() first so there's actually a process on the other end before sending anything. */
export function createLspConnection(language: string, workspaceRoot: string): MessageConnection {
  const connection = createMessageConnection(
    new IpcMessageReader(language, workspaceRoot),
    new IpcMessageWriter(language, workspaceRoot),
  );
  connection.listen();
  return connection;
}
