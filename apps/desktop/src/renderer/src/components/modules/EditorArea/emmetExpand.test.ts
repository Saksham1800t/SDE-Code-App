import { describe, expect, it } from 'vitest';
import { computeEmmetExpansion, isEmmetEligibleLanguage } from './emmetExpand';

describe('isEmmetEligibleLanguage', () => {
  it('accepts html, css, scss, less, javascript, and typescript', () => {
    for (const lang of ['html', 'css', 'scss', 'less', 'javascript', 'typescript']) {
      expect(isEmmetEligibleLanguage(lang)).toBe(true);
    }
  });

  it('rejects languages outside the HTML/CSS/JSX-like scope', () => {
    for (const lang of ['python', 'markdown', 'json', 'yaml', 'plaintext']) {
      expect(isEmmetEligibleLanguage(lang)).toBe(false);
    }
  });
});

describe('computeEmmetExpansion', () => {
  it('expands a simple HTML tag abbreviation at end of line', () => {
    const result = computeEmmetExpansion('div', 4, 'html');

    expect(result).not.toBeNull();
    expect(result!.startColumn).toBe(1);
    expect(result!.endColumn).toBe(4);
    expect(result!.expanded).toContain('<div>');
    expect(result!.expanded).toContain('</div>');
  });

  it('expands a class-shorthand abbreviation', () => {
    const result = computeEmmetExpansion('div.container', 14, 'html');

    expect(result!.expanded).toContain('class="container"');
  });

  it('expands a multiplied abbreviation into repeated elements', () => {
    const result = computeEmmetExpansion('li*3', 5, 'html');

    expect(result!.expanded.match(/<li>/g)).toHaveLength(3);
  });

  it('expands a CSS property shorthand', () => {
    const result = computeEmmetExpansion('m10', 4, 'css');

    expect(result!.expanded.replace(/\s/g, '')).toBe('margin:10px;');
  });

  it('only replaces the abbreviation, not preceding text on the same line', () => {
    const line = '  const x = 1; div'; // 18 chars; "div" is the last 3
    const result = computeEmmetExpansion(line, line.length + 1, 'html');

    expect(result!.startColumn).toBe(16); // right after "1; "
    expect(result!.endColumn).toBe(line.length + 1);
  });

  it('uses className instead of class for JS/TS (JSX) abbreviations', () => {
    const result = computeEmmetExpansion('div.foo', 8, 'typescript');

    expect(result!.expanded).toContain('className="foo"');
  });

  it('returns null for a language outside the eligible set', () => {
    expect(computeEmmetExpansion('div', 4, 'python')).toBeNull();
  });

  it('returns null when the cursor sits right after trailing whitespace, with nothing extractable before it', () => {
    expect(computeEmmetExpansion('hello ', 'hello '.length + 1, 'html')).toBeNull();
  });

  it('returns null for an empty line', () => {
    expect(computeEmmetExpansion('', 1, 'html')).toBeNull();
  });

  // Note: unlike a real "no abbreviation found" case, Emmet's markup type
  // treats *any* bare word as a valid tag-name abbreviation (e.g. 'world'
  // alone expands to '<world></world>') — confirmed empirically, and by
  // design (that's the core Emmet feature). computeEmmetExpansion's
  // expanded-equals-input guard exists for the theoretical case where a
  // future syntax config genuinely echoes input back unchanged; no
  // scenario in the currently-configured languages reaches it, so it's
  // intentionally left uncovered here rather than tested via a
  // constructed-but-unrealistic input.
});
