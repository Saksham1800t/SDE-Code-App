import { describe, expect, it } from 'vitest';
import { tokenizeArgs } from './shellTokenize';

describe('tokenizeArgs', () => {
  it('splits plain space-separated args', () => {
    expect(tokenizeArgs('--yes --message {prompt}')).toEqual(['--yes', '--message', '{prompt}']);
  });

  it('keeps a double-quoted segment as one token', () => {
    expect(tokenizeArgs('--message "fix the bug" --yes')).toEqual(['--message', 'fix the bug', '--yes']);
  });

  it('keeps a single-quoted segment as one token', () => {
    expect(tokenizeArgs("--message 'fix the bug'")).toEqual(['--message', 'fix the bug']);
  });

  it('collapses repeated whitespace between tokens', () => {
    expect(tokenizeArgs('--yes   --quiet')).toEqual(['--yes', '--quiet']);
  });

  it('trims leading/trailing whitespace', () => {
    expect(tokenizeArgs('  --yes  ')).toEqual(['--yes']);
  });

  it('returns an empty array for an empty or whitespace-only string', () => {
    expect(tokenizeArgs('')).toEqual([]);
    expect(tokenizeArgs('   ')).toEqual([]);
  });

  it('handles a quoted segment adjacent to unquoted text as one merged token', () => {
    expect(tokenizeArgs('--path="/my dir"/sub')).toEqual(['--path=/my dir/sub']);
  });
});
