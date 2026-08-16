import { describe, expect, it } from 'vitest';
import { parseNpmScripts, npmDetector } from './npmScripts';

describe('parseNpmScripts', () => {
  it('returns one task per scripts entry', () => {
    const content = JSON.stringify({ scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' } });

    const tasks = parseNpmScripts(content);

    expect(tasks).toEqual([
      { id: 'dev', name: 'npm: dev', command: 'npm run dev' },
      { id: 'build', name: 'npm: build', command: 'npm run build' },
      { id: 'test', name: 'npm: test', command: 'npm run test' },
    ]);
  });

  it('preserves script declaration order', () => {
    const content = JSON.stringify({ scripts: { z: 'echo z', a: 'echo a', m: 'echo m' } });

    expect(parseNpmScripts(content).map((t) => t.id)).toEqual(['z', 'a', 'm']);
  });

  it('returns an empty array (not an error) for a package.json with no scripts field', () => {
    expect(parseNpmScripts(JSON.stringify({ name: 'my-pkg' }))).toEqual([]);
  });

  it('returns an empty array for an empty scripts object', () => {
    expect(parseNpmScripts(JSON.stringify({ scripts: {} }))).toEqual([]);
  });

  it('returns an empty array (not a throw) for invalid JSON', () => {
    expect(parseNpmScripts('{ not valid json')).toEqual([]);
  });

  it('returns an empty array for JSON that parses but is not an object (e.g. a bare array)', () => {
    expect(parseNpmScripts('[1, 2, 3]')).toEqual([]);
  });

  it('skips a non-string script value instead of crashing on it', () => {
    const content = JSON.stringify({ scripts: { dev: 'vite', broken: { nested: true } } });

    expect(parseNpmScripts(content)).toEqual([{ id: 'dev', name: 'npm: dev', command: 'npm run dev' }]);
  });

  it('assigns the tsc problem matcher when the script command invokes tsc', () => {
    const content = JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } });

    expect(parseNpmScripts(content)).toEqual([
      { id: 'typecheck', name: 'npm: typecheck', command: 'npm run typecheck', problemMatcher: 'tsc' },
    ]);
  });

  it('assigns the eslint problem matcher when the script command invokes eslint', () => {
    const content = JSON.stringify({ scripts: { lint: 'eslint . --ext .ts,.tsx' } });

    expect(parseNpmScripts(content)).toEqual([
      { id: 'lint', name: 'npm: lint', command: 'npm run lint', problemMatcher: 'eslint' },
    ]);
  });

  it('does not assign a matcher for an unrelated command, even one that mentions "tsc" as a substring of another word', () => {
    const content = JSON.stringify({ scripts: { build: 'webpack --config webpack.config.js' } });

    expect(parseNpmScripts(content)[0].problemMatcher).toBeUndefined();
  });
});

describe('npmDetector', () => {
  it('is registered under the "npm" id against package.json', () => {
    expect(npmDetector.id).toBe('npm');
    expect(npmDetector.markerFile).toBe('package.json');
  });

  it('delegates to parseNpmScripts', () => {
    const content = JSON.stringify({ scripts: { dev: 'vite' } });
    expect(npmDetector.parse(content)).toEqual(parseNpmScripts(content));
  });
});
