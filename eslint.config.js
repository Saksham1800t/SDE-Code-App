// @ts-check
import tseslint from 'typescript-eslint';
import layersPlugin from '@sde-code/eslint-plugin-layers';

// Intentionally minimal for now: this config exists only to enforce the
// kernel < platform < editor < extension-host < workbench < host layering
// rule inside the desktop app (see tools/lint-rules). It is NOT yet a
// general code-quality baseline (no-explicit-any, no-unused-vars, etc.) for
// the rest of the codebase — that's a separate decision to make deliberately,
// not something to bundle in silently. Scope this out further, feature by
// feature, as each layer gets real code in it.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/node_modules/**',
      '**/*.d.ts',
      'apps/desktop/extensions/**',
    ],
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@sde-code/layers': layersPlugin,
    },
    rules: {
      '@sde-code/layers/layer-boundaries': ['error', { srcRoot: 'apps/desktop/src' }],
    },
  },
);
