import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry. Named index.ts (not main.ts) deliberately:
        // vite-plugin-electron names the build output after the entry
        // file's own basename, and package.json's "main" field expects
        // dist-electron/main/index.js.
        entry: 'src/host/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            rollupOptions: {
              // sql.js/node-pty: native modules that must stay real runtime
              // requires, not bundled. bufferutil/utf-8-validate: optional
              // native peer deps of `ws` (pulled in transitively by
              // @google/genai) that aren't installed — ws already wraps its
              // own require() of these in a try/catch and falls back to a
              // pure-JS implementation; bundling them turns that into a
              // hard build-time resolution failure instead of the graceful
              // runtime fallback ws expects.
              external: ['sql.js', 'node-pty', 'bufferutil', 'utf-8-validate'],
            },
          },
        },
      },
      {
        // Preload script
        entry: 'src/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            minify: false,
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
});
