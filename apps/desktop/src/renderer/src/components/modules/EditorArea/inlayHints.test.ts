import { describe, expect, it, vi } from 'vitest';

// inlayHints.ts imports store/editorSettings.ts, which now imports
// store/commands.ts (Phase 28, to read the active profile) — same
// vi.hoisted window stub as commands.test.ts, for the same reason (see
// store/editorSettings.test.ts's comment).
vi.hoisted(() => {
  (globalThis as any).window = { api: undefined };
});

import { applyInlayHintsOptions } from './inlayHints';

function makeFakeMonaco() {
  return {
    languages: {
      typescript: {
        typescriptDefaults: { setInlayHintsOptions: vi.fn() },
        javascriptDefaults: { setInlayHintsOptions: vi.fn() },
      },
    },
  };
}

describe('applyInlayHintsOptions', () => {
  it('sets every hint category to "on" (or all/true) for both TS and JS defaults when enabled', () => {
    const monaco = makeFakeMonaco();

    applyInlayHintsOptions(monaco, true);

    expect(monaco.languages.typescript.typescriptDefaults.setInlayHintsOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        includeInlayParameterNameHints: 'all',
        includeInlayVariableTypeHints: true,
        includeInlayFunctionLikeReturnTypeHints: true,
      }),
    );
    expect(monaco.languages.typescript.javascriptDefaults.setInlayHintsOptions).toHaveBeenCalledWith(
      expect.objectContaining({ includeInlayParameterNameHints: 'all' }),
    );
  });

  it('sets includeInlayParameterNameHints to "none" for both TS and JS defaults when disabled', () => {
    const monaco = makeFakeMonaco();

    applyInlayHintsOptions(monaco, false);

    expect(monaco.languages.typescript.typescriptDefaults.setInlayHintsOptions).toHaveBeenCalledWith({
      includeInlayParameterNameHints: 'none',
    });
    expect(monaco.languages.typescript.javascriptDefaults.setInlayHintsOptions).toHaveBeenCalledWith({
      includeInlayParameterNameHints: 'none',
    });
  });

  it('does not throw if monaco.languages.typescript is unavailable', () => {
    expect(() => applyInlayHintsOptions({ languages: {} }, true)).not.toThrow();
  });
});
