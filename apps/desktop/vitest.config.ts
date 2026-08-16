import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Deliberately separate from vite.config.ts (which wires the Electron main/
// preload/renderer build). Kernel and platform code is plain TypeScript with
// no DOM or Electron dependency, so it runs under Node with no plugins at all.
export default defineConfig({
  resolve: {
    alias: {
      // monaco-editor is browser-only (DOM globals at import time, no
      // resolvable entry under plain Node resolution) — several renderer
      // store tests transitively import it via store/workspace.ts -> lsp/
      // without exercising any real Monaco behavior. See monacoEditorStub.ts.
      'monaco-editor': resolve(__dirname, 'src/test/monacoEditorStub.ts'),
      'vscode-jsonrpc/browser': resolve(__dirname, 'src/test/vscodeJsonrpcBrowserStub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
