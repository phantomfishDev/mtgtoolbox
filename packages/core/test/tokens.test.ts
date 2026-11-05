import { describe, expect, it } from 'vitest';
import { setTokensSection } from '../src/decklist/tokens.js';
import { bareSectionHeader, parseDecklist } from '../src/decklist/parse.js';

describe('bareSectionHeader', () => {
  it('recognises headers the parser recognises, and nothing else', () => {
    expect(bareSectionHeader('Tokens')).toBe('tokens');
    expect(bareSectionHeader('  tokens:  ')).toBe('tokens');
    expect(bareSectionHeader('Mainboard')).toBe('deck');
    expect(bareSectionHeader('1 Sol Ring')).toBeUndefined();
    expect(bareSectionHeader('')).toBeUndefined();
  });
});

describe('setTokensSection', () => {
  const deck = ['Commander', '1 Lord of the Nazgûl', '', 'Deck', '1 Sol Ring', ''].join('\n');

  it('appends a section when there is none, keeping one blank line before it', () => {
    const out = setTokensSection(deck, ['9 Wraith (TLTC) 7']);
    expect(out).toBe(
      ['Commander', '1 Lord of the Nazgûl', '', 'Deck', '1 Sol Ring', '', 'Tokens', '9 Wraith (TLTC) 7', ''].join('\n'),
    );
  });

  it('round-trips: what it writes, the parser reads back as tokens', () => {
    const out = setTokensSection(deck, ['9 Wraith (TLTC) 7', '3 Clue (TTRK) 1']);
    const entries = parseDecklist(out).entries.filter((entry) => entry.section === 'tokens');
    expect(entries.map((entry) => [entry.quantity, entry.name, entry.set])).toEqual([
      [9, 'Wraith', 'tltc'],
      [3, 'Clue', 'ttrk'],
    ]);
  });

  it('replaces an existing section rather than adding a second one', () => {
    const once = setTokensSection(deck, ['4 Wraith (TLTC) 7']);
    const twice = setTokensSection(once, ['9 Wraith (TLTC) 7']);
    expect(twice.match(/^Tokens$/gm)).toHaveLength(1);
    expect(twice).toContain('9 Wraith (TLTC) 7');
    expect(twice).not.toContain('4 Wraith');
  });

  it('returns the original string when nothing would change, so no write is needed', () => {
    const once = setTokensSection(deck, ['4 Wraith (TLTC) 7']);
    expect(setTokensSection(once, ['4 Wraith (TLTC) 7'])).toBe(once);
  });

  it('leaves the rest of the file alone when a section follows the tokens', () => {
    const withSideboard = ['Deck', '1 Sol Ring', '', 'Tokens', '1 Clue', '', 'Sideboard', '1 Negate', ''].join('\n');
    const out = setTokensSection(withSideboard, ['9 Wraith (TLTC) 7']);
    expect(out).toContain('Sideboard');
    expect(out).toContain('1 Negate');
    expect(out).not.toContain('1 Clue');
    expect(parseDecklist(out).entries.find((entry) => entry.name === 'Negate')?.section).toBe('sideboard');
  });

  it('removes the section when given no lines', () => {
    const once = setTokensSection(deck, ['4 Wraith (TLTC) 7']);
    const cleared = setTokensSection(once, []);
    expect(cleared).not.toContain('Tokens');
    expect(parseDecklist(cleared).entries.every((entry) => entry.section !== 'tokens')).toBe(true);
  });

  it('keeps a comment header above the section intact', () => {
    const commented = ['# My deck.', '', 'Deck', '1 Sol Ring', ''].join('\n');
    const out = setTokensSection(commented, ['1 Clue (TTRK) 1']);
    expect(out.startsWith('# My deck.')).toBe(true);
  });
});
