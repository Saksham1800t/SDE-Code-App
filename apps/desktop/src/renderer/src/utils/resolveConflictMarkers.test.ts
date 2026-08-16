import { describe, expect, it } from 'vitest';
import { resolveConflictMarkers, countConflictBlocks } from './resolveConflictMarkers';

const CONFLICTED = [
  'line before',
  '<<<<<<< HEAD',
  'current line 1',
  'current line 2',
  '=======',
  'incoming line 1',
  '>>>>>>> feature-branch',
  'line after',
].join('\n');

describe('resolveConflictMarkers', () => {
  it('accepting "current" keeps the HEAD side and drops the incoming side', () => {
    const result = resolveConflictMarkers(CONFLICTED, 'current');
    expect(result).toBe(['line before', 'current line 1', 'current line 2', 'line after'].join('\n'));
  });

  it('accepting "incoming" keeps the other-branch side and drops HEAD', () => {
    const result = resolveConflictMarkers(CONFLICTED, 'incoming');
    expect(result).toBe(['line before', 'incoming line 1', 'line after'].join('\n'));
  });

  it('accepting "both" keeps current followed by incoming, markers removed', () => {
    const result = resolveConflictMarkers(CONFLICTED, 'both');
    expect(result).toBe(['line before', 'current line 1', 'current line 2', 'incoming line 1', 'line after'].join('\n'));
  });

  it('resolves multiple conflict blocks in the same file', () => {
    const twoBlocks = [
      '<<<<<<< HEAD',
      'A',
      '=======',
      'B',
      '>>>>>>> theirs',
      'middle',
      '<<<<<<< HEAD',
      'C',
      '=======',
      'D',
      '>>>>>>> theirs',
    ].join('\n');
    expect(countConflictBlocks(twoBlocks)).toBe(2);
    expect(resolveConflictMarkers(twoBlocks, 'current')).toBe(['A', 'middle', 'C'].join('\n'));
  });

  it('leaves a file with no conflict markers untouched', () => {
    const plain = 'just some\nordinary content';
    expect(resolveConflictMarkers(plain, 'current')).toBe(plain);
    expect(countConflictBlocks(plain)).toBe(0);
  });

  it('handles CRLF line endings — git on Windows commonly writes these, and a CRLF-blind match silently no-ops instead of erroring', () => {
    const crlf = [
      'line one',
      '<<<<<<< HEAD',
      'MAIN VALUE',
      '=======',
      'FEATURE VALUE',
      '>>>>>>> feature-branch',
      'line three',
    ].join('\r\n') + '\r\n';

    expect(countConflictBlocks(crlf)).toBe(1);
    const result = resolveConflictMarkers(crlf, 'both');
    expect(result).toBe(['line one', 'MAIN VALUE', 'FEATURE VALUE', 'line three'].join('\r\n') + '\r\n');
    expect(result).not.toContain('<<<<<<<');
  });
});
