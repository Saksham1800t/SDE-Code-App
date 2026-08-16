/**
 * Stands in for `vscode-jsonrpc/browser` under Vitest, same reasoning as
 * monacoEditorStub.ts: its `exports` map gates the `./browser` subpath
 * behind a `browser` condition plain Node resolution doesn't set, and it's
 * only reachable here because store/workspace.ts -> lsp/ -> lspClientManager.ts
 * imports lspTransport.ts at module scope, not because any of the currently
 * failing tests exercise a real LSP connection.
 *
 * AbstractMessageReader/Writer must be real constructable classes — lspTransport.ts's
 * IpcMessageReader/IpcMessageWriter `extends` them at module scope, so a
 * stubbed non-function here would throw immediately on import, before any
 * test body even runs.
 */

export class AbstractMessageReader {
  onError() { return { dispose() {} }; }
  onClose() { return { dispose() {} }; }
  onPartialMessage() { return { dispose() {} }; }
  dispose() {}
}

export class AbstractMessageWriter {
  onError() { return { dispose() {} }; }
  onClose() { return { dispose() {} }; }
  fireError() {}
  fireClose() {}
  end() {}
  dispose() {}
}

export function createMessageConnection() {
  return {
    listen() {},
    dispose() {},
    onNotification: () => ({ dispose() {} }),
    onRequest: () => ({ dispose() {} }),
    sendNotification: () => {},
    sendRequest: () => Promise.resolve(null),
  };
}
