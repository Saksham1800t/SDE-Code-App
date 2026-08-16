import { describe, expect, it } from 'vitest';
import { parseWorkspaceFile, serializeWorkspaceFile } from './workspaceFile';

describe('parseWorkspaceFile', () => {
  it('parses a well-formed workspace file into its folder list', () => {
    const raw = JSON.stringify({ folders: [{ path: 'C:/repo-a', name: 'repo-a' }, { path: 'C:/repo-b', name: 'repo-b' }] });

    expect(parseWorkspaceFile(raw)).toEqual([
      { path: 'C:/repo-a', name: 'repo-a' },
      { path: 'C:/repo-b', name: 'repo-b' },
    ]);
  });

  it('preserves folder order', () => {
    const raw = JSON.stringify({ folders: [{ path: 'z', name: 'z' }, { path: 'a', name: 'a' }] });
    expect(parseWorkspaceFile(raw).map((f) => f.path)).toEqual(['z', 'a']);
  });

  it('returns an empty array (not a throw) for invalid JSON', () => {
    expect(parseWorkspaceFile('{ not valid json')).toEqual([]);
  });

  it('returns an empty array when the folders field is missing', () => {
    expect(parseWorkspaceFile(JSON.stringify({}))).toEqual([]);
  });

  it('returns an empty array when folders is not an array', () => {
    expect(parseWorkspaceFile(JSON.stringify({ folders: 'nope' }))).toEqual([]);
  });

  it('drops an entry missing a string path or name rather than throwing', () => {
    const raw = JSON.stringify({
      folders: [
        { path: 'C:/good', name: 'good' },
        { path: 'C:/no-name' },
        { name: 'no-path' },
        { path: 123, name: 'bad-path-type' },
        null,
        'not-an-object',
      ],
    });

    expect(parseWorkspaceFile(raw)).toEqual([{ path: 'C:/good', name: 'good' }]);
  });

  it('returns an empty array for an empty folders list', () => {
    expect(parseWorkspaceFile(JSON.stringify({ folders: [] }))).toEqual([]);
  });
});

describe('serializeWorkspaceFile', () => {
  it('round-trips through parseWorkspaceFile', () => {
    const folders = [{ path: 'C:/repo-a', name: 'repo-a' }, { path: 'C:/repo-b', name: 'repo-b' }];
    expect(parseWorkspaceFile(serializeWorkspaceFile(folders))).toEqual(folders);
  });

  it('only writes the path/name fields, dropping any extra properties on the input objects', () => {
    const folders = [{ path: 'C:/repo', name: 'repo', extra: 'should not appear' } as any];
    const written = JSON.parse(serializeWorkspaceFile(folders));
    expect(written.folders).toEqual([{ path: 'C:/repo', name: 'repo' }]);
  });

  it('writes an empty folders array for no folders', () => {
    expect(JSON.parse(serializeWorkspaceFile([]))).toEqual({ folders: [] });
  });
});
