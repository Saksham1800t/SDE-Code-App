import { describe, expect, it } from 'vitest';
import { getFileIconUrl } from './fileIcons';

describe('getFileIconUrl — icon theme overrides', () => {
  it('falls back to the built-in vscode-icons set when no icon map is supplied', () => {
    expect(getFileIconUrl('index.ts')).toContain('file_type_typescript.svg');
  });

  it('uses an icon-theme override keyed by extension over the built-in default', () => {
    const url = getFileIconUrl('index.ts', { ts: 'https://example.com/custom-ts.svg' });
    expect(url).toBe('https://example.com/custom-ts.svg');
  });

  it('uses an icon-theme override keyed by exact filename over an extension-keyed entry', () => {
    const url = getFileIconUrl('package.json', {
      json: 'https://example.com/generic-json.svg',
      'package.json': 'https://example.com/npm-special.svg',
    });
    expect(url).toBe('https://example.com/npm-special.svg');
  });

  it('falls back to the built-in set for any file the icon map does not cover', () => {
    const url = getFileIconUrl('index.ts', { py: 'https://example.com/custom-py.svg' });
    expect(url).toContain('file_type_typescript.svg');
  });
});
