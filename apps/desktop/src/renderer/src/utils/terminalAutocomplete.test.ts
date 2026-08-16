import { describe, expect, it } from 'vitest';
import {
  getCompletionKind,
  getCurrentToken,
  splitPathToken,
  joinPath,
  resolveCdTarget,
  matchByPrefix,
  formatPathCandidates,
  longestCommonPrefix,
  computeCompletion,
} from './terminalAutocomplete';

describe('getCompletionKind', () => {
  it('treats the first word with no path separator as a command', () => {
    expect(getCompletionKind('gi')).toBe('command');
    expect(getCompletionKind('git')).toBe('command');
  });

  it('treats anything after the first word as a path', () => {
    expect(getCompletionKind('cd sr')).toBe('path');
    expect(getCompletionKind('git chec')).toBe('path');
  });

  it('treats a trailing space after the command as a path (empty token)', () => {
    expect(getCompletionKind('cd ')).toBe('path');
  });

  it('treats a first word containing a path separator as a path, not a command', () => {
    expect(getCompletionKind('./scr')).toBe('path');
    expect(getCompletionKind('C:\\Us')).toBe('path');
    expect(getCompletionKind('bin/to')).toBe('path');
  });

  it('ignores leading whitespace', () => {
    expect(getCompletionKind('   gi')).toBe('command');
  });
});

describe('getCurrentToken', () => {
  it('returns the whole line when there is only one word', () => {
    expect(getCurrentToken('gi')).toBe('gi');
  });

  it('returns the last word after a space', () => {
    expect(getCurrentToken('cd sr')).toBe('sr');
    expect(getCurrentToken('git checkout fea')).toBe('fea');
  });

  it('returns empty string when the line ends in whitespace', () => {
    expect(getCurrentToken('cd ')).toBe('');
    expect(getCurrentToken('cd   ')).toBe('');
  });

  it('returns empty string for an empty or all-whitespace line', () => {
    expect(getCurrentToken('')).toBe('');
    expect(getCurrentToken('   ')).toBe('');
  });

  it('collapses multiple spaces between words', () => {
    expect(getCurrentToken('cd    sr')).toBe('sr');
  });
});

describe('splitPathToken', () => {
  it('splits a token with a forward-slash directory part', () => {
    expect(splitPathToken('src/comp')).toEqual({ dirPart: 'src/', namePart: 'comp' });
  });

  it('splits a token with a backslash directory part', () => {
    expect(splitPathToken('src\\comp')).toEqual({ dirPart: 'src\\', namePart: 'comp' });
  });

  it('returns an empty dirPart when there is no separator', () => {
    expect(splitPathToken('sr')).toEqual({ dirPart: '', namePart: 'sr' });
  });

  it('handles a token ending in a separator (empty namePart)', () => {
    expect(splitPathToken('src/')).toEqual({ dirPart: 'src/', namePart: '' });
  });

  it('uses the last separator for a multi-level path', () => {
    expect(splitPathToken('src/components/Bu')).toEqual({ dirPart: 'src/components/', namePart: 'Bu' });
  });
});

describe('joinPath', () => {
  it('returns base unchanged when relative is empty', () => {
    expect(joinPath('C:/repo', '')).toBe('C:/repo');
  });

  it('joins a simple relative path onto a Windows base', () => {
    expect(joinPath('C:/repo', 'src')).toBe('C:/repo/src');
  });

  it('resolves .. against the base', () => {
    expect(joinPath('C:/repo/src/components', '..')).toBe('C:/repo/src');
  });

  it('resolves a nested relative path with mixed segments', () => {
    expect(joinPath('C:/repo', 'src/../lib')).toBe('C:/repo/lib');
  });

  it('treats a POSIX absolute path as absolute regardless of base', () => {
    expect(joinPath('C:/repo', '/etc')).toBe('/etc');
  });

  it('treats a Windows drive-letter path as absolute regardless of base', () => {
    expect(joinPath('C:/repo', 'D:/other')).toBe('D:/other');
  });

  it('normalizes backslashes in the relative argument to forward slashes', () => {
    expect(joinPath('C:/repo', 'src\\components')).toBe('C:/repo/src/components');
  });

  it('joins correctly against a POSIX base', () => {
    expect(joinPath('/home/user/repo', 'src')).toBe('/home/user/repo/src');
  });
});

describe('resolveCdTarget', () => {
  it('resolves a simple relative cd target', () => {
    expect(resolveCdTarget('C:/repo', 'cd src')).toBe('C:/repo/src');
  });

  it('is case-insensitive on the cd keyword', () => {
    expect(resolveCdTarget('C:/repo', 'CD src')).toBe('C:/repo/src');
  });

  it('resolves cd .. against the current cwd', () => {
    expect(resolveCdTarget('C:/repo/src', 'cd ..')).toBe('C:/repo');
  });

  it('strips simple surrounding quotes from the target', () => {
    expect(resolveCdTarget('C:/repo', 'cd "my folder"')).toBe('C:/repo/my folder');
  });

  it('leaves cwd unchanged for a bare cd with no argument', () => {
    expect(resolveCdTarget('C:/repo', 'cd')).toBe('C:/repo');
  });

  it('leaves cwd unchanged for cd ~ (no known HOME to resolve against)', () => {
    expect(resolveCdTarget('C:/repo', 'cd ~')).toBe('C:/repo');
  });

  it('leaves cwd unchanged for a non-cd line', () => {
    expect(resolveCdTarget('C:/repo', 'git status')).toBe('C:/repo');
    expect(resolveCdTarget('C:/repo', 'echo cd fake')).toBe('C:/repo');
  });

  it('resolves an absolute cd target directly', () => {
    expect(resolveCdTarget('C:/repo', 'cd D:/other')).toBe('D:/other');
  });
});

describe('matchByPrefix', () => {
  it('filters candidates by case-insensitive prefix', () => {
    expect(matchByPrefix(['git', 'grep', 'go', 'node'], 'g')).toEqual(['git', 'go', 'grep']);
  });

  it('matches regardless of the candidate or query casing', () => {
    expect(matchByPrefix(['README.md', 'readme.txt'], 'rea')).toEqual(['README.md', 'readme.txt']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(matchByPrefix(['git', 'node'], 'zzz')).toEqual([]);
  });

  it('returns every candidate for an empty partial', () => {
    expect(matchByPrefix(['b', 'a', 'c'], '')).toEqual(['a', 'b', 'c']);
  });
});

describe('formatPathCandidates', () => {
  it('appends a trailing slash for directories only', () => {
    expect(
      formatPathCandidates([
        { name: 'src', isDirectory: true },
        { name: 'package.json', isDirectory: false },
      ]),
    ).toEqual(['src/', 'package.json']);
  });
});

describe('longestCommonPrefix', () => {
  it('finds a multi-character common prefix', () => {
    expect(longestCommonPrefix(['scripts/', 'screenshots/', 'scratch/'])).toBe('scr');
  });

  it('returns the single string unchanged for one candidate', () => {
    expect(longestCommonPrefix(['src/'])).toBe('src/');
  });

  it('returns empty string when candidates share no prefix', () => {
    expect(longestCommonPrefix(['abc', 'xyz'])).toBe('');
  });

  it('returns empty string for an empty candidate list', () => {
    expect(longestCommonPrefix([])).toBe('');
  });

  it('is case-insensitive when comparing but preserves original casing in the result', () => {
    expect(longestCommonPrefix(['README.md', 'readme.txt'])).toBe('README.');
  });
});

describe('computeCompletion', () => {
  it('sends the full remainder for a single unambiguous match', () => {
    const result = computeCompletion(['src', 'scripts'], 'sr');
    expect(result.matches).toEqual(['src']);
    expect(result.suffixToSend).toBe('c');
  });

  it('sends nothing and returns an empty matches list when nothing matches', () => {
    const result = computeCompletion(['src', 'scripts'], 'zzz');
    expect(result.matches).toEqual([]);
    expect(result.suffixToSend).toBe('');
  });

  it('partially completes to the longest common prefix when multiple matches share more than what is typed', () => {
    const result = computeCompletion(['scripts', 'screenshots', 'scratch', 'node_modules'], 's');
    expect(result.matches).toEqual(['scratch', 'screenshots', 'scripts']);
    expect(result.suffixToSend).toBe('cr');
  });

  it('sends nothing (dropdown only) when multiple matches share no more than what is already typed', () => {
    const result = computeCompletion(['src', 'srv'], 'sr');
    expect(result.matches).toEqual(['src', 'srv']);
    expect(result.suffixToSend).toBe('');
  });

  it('is case-insensitive end to end while preserving real casing in the sent suffix', () => {
    const result = computeCompletion(['README.md'], 'rea');
    expect(result.suffixToSend).toBe('DME.md');
  });
});
