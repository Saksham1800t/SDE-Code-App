import { describe, expect, it } from 'vitest';
import { translateSemanticTokensData } from './lspLanguageClient';

describe('translateSemanticTokensData', () => {
  it('remaps type and modifier indices from a scrambled server legend into canonical indices, leaving position fields untouched', () => {
    // Server's legend order deliberately differs from the canonical list (see lspLanguageClient.ts): variable=0, function=1, keyword=2; declaration=bit0.
    const serverLegend = { tokenTypes: ['variable', 'function', 'keyword'], tokenModifiers: ['declaration'] };
    // 'x' variable+declaration; 'def' keyword, no mods; 'foo' function+declaration (same line, deltaChar=4).
    const raw = [0, 0, 1, 0, 1, 1, 0, 3, 2, 0, 0, 4, 3, 1, 1];

    const result = Array.from(translateSemanticTokensData(raw, serverLegend));

    // Canonical indices: variable=8, function=12, keyword=15; declaration=canonical bit0=1.
    expect(result).toEqual([0, 0, 1, 8, 1, 1, 0, 3, 15, 0, 0, 4, 3, 12, 1]);
  });

  it('falls back an unrecognized token type to canonical index 0 instead of dropping the token, so later tokens keep decoding at the right position', () => {
    const serverLegend = { tokenTypes: ['someCustomVendorType'], tokenModifiers: [] };
    const raw = [0, 0, 1, 0, 0, /* next token */ 1, 0, 3, 0, 0];

    const result = Array.from(translateSemanticTokensData(raw, serverLegend));

    expect(result).toHaveLength(10);
    expect(result[3]).toBe(0); // unrecognized type falls back to 0
    expect(result[5]).toBe(1); // second token's deltaLine is untouched, proving no token was dropped
  });

  it('drops an unrecognized modifier bit from the rebuilt bitset without affecting the type index or position', () => {
    const serverLegend = { tokenTypes: ['keyword'], tokenModifiers: ['someCustomModifier'] };
    const raw = [2, 4, 5, 0, 1]; // bit0 set, but 'someCustomModifier' has no canonical equivalent

    const result = Array.from(translateSemanticTokensData(raw, serverLegend));

    expect(result).toEqual([2, 4, 5, 15, 0]); // keyword -> canonical 15, modifiers bitset empty
  });

  it('returns an empty array for empty input', () => {
    expect(translateSemanticTokensData([], { tokenTypes: [], tokenModifiers: [] })).toHaveLength(0);
  });
});
