import { describe, expect, it } from 'vitest';
import {
  commanders,
  extractFromMarkdown,
  mergeEntries,
  parseDecklist,
  totalCards,
} from '../src/decklist/parse.js';

describe('parseDecklist', () => {
  it('parses plain quantity-and-name lines', () => {
    const { entries, errors } = parseDecklist('1 Sol Ring\n7 Swamp\n4x Lightning Bolt');
    expect(errors).toEqual([]);
    expect(entries.map((e) => [e.quantity, e.name])).toEqual([
      [1, 'Sol Ring'],
      [7, 'Swamp'],
      [4, 'Lightning Bolt'],
    ]);
  });

  it('defaults a bare card name to one copy', () => {
    const { entries } = parseDecklist('Sol Ring');
    expect(entries[0]).toMatchObject({ quantity: 1, name: 'Sol Ring' });
  });

  it('reads the Arena printing suffix', () => {
    const { entries } = parseDecklist('1 Sol Ring (LTC) 264\n1 Cultivate (MSC) 172 *F*');
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', set: 'ltc', collectorNumber: '264' });
    expect(entries[1]).toMatchObject({ name: 'Cultivate', set: 'msc', collectorNumber: '172' });
  });

  it('keeps parenthesised names that are not printings', () => {
    const { entries } = parseDecklist('1 Erayo, Soratami Ascendant');
    expect(entries[0]?.name).toBe('Erayo, Soratami Ascendant');
  });

  it('treats a leading // as a comment but keeps DFC separators', () => {
    const { entries } = parseDecklist('// commander\n1 Malakir Rebirth // Malakir Mire');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Malakir Rebirth // Malakir Mire');
  });

  it('skips section headers and unwraps labelled ones', () => {
    const { entries } = parseDecklist('Commander\n1 Atraxa\n\nDeck\n1 Sol Ring');
    expect(entries.map((e) => e.name)).toEqual(['Atraxa', 'Sol Ring']);
  });

  it('reads a card name off a labelled header line', () => {
    const { entries } = parseDecklist('Commander: Atraxa, Praetors’ Voice');
    expect(entries[0]).toMatchObject({ quantity: 1, name: 'Atraxa, Praetors’ Voice' });
  });

  it('tags entries with the section they appeared under', () => {
    const { entries } = parseDecklist('Commander\n1 Atraxa\n\nDeck\n1 Sol Ring');
    expect(entries[0]).toMatchObject({ name: 'Atraxa', section: 'commander' });
    expect(entries[1]).toMatchObject({ name: 'Sol Ring', section: 'deck' });
  });

  it('folds section aliases onto one canonical name', () => {
    const { entries } = parseDecklist('Commanders\n1 Atraxa\n\nMainboard\n1 Sol Ring');
    expect(entries[0]?.section).toBe('commander');
    expect(entries[1]?.section).toBe('deck');
  });

  it('tags a labelled commander line too', () => {
    const { entries } = parseDecklist('Commander: Atraxa');
    expect(entries[0]?.section).toBe('commander');
  });

  it('leaves entries above any header without a section', () => {
    const { entries } = parseDecklist('1 Sol Ring');
    expect(entries[0]?.section).toBeUndefined();
  });

  it('extracts the commanders from a list', () => {
    const { entries } = parseDecklist('Commander\n1 Rootha\n1 Muddle\n\nDeck\n1 Sol Ring');
    expect(commanders(entries).map((e) => e.name)).toEqual(['Rootha', 'Muddle']);
  });

  it('does not merge a commander into an identically named deck entry', () => {
    // A card can legitimately appear in both zones across formats; collapsing
    // them would lose the commander tag and miscount the deck.
    const { entries } = parseDecklist('Commander\n1 Sol Ring\n\nDeck\n1 Sol Ring');
    expect(mergeEntries(entries)).toHaveLength(2);
  });

  it('reports every bad line instead of throwing', () => {
    const { entries, errors } = parseDecklist('1 Sol Ring\n0 Broken\n2 Island');
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('quantity') });
  });

  it('counts and merges duplicate printings', () => {
    const { entries } = parseDecklist('2 Swamp\n5 Swamp\n1 Sol Ring');
    expect(totalCards(entries)).toBe(8);
    const merged = mergeEntries(entries);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ name: 'Swamp', quantity: 7 });
  });

  it('does not merge different printings of the same card', () => {
    const { entries } = parseDecklist('1 Sol Ring (LTC) 264\n1 Sol Ring (CMM) 1');
    expect(mergeEntries(entries)).toHaveLength(2);
  });
});

describe('extractFromMarkdown', () => {
  const guide = [
    '# Atraxa - Commander Deck Guide',
    '',
    '## 4. Mana curve',
    '',
    '```',
    'MV 1: 8 cards',
    'MV 2: 12 cards',
    '```',
    '',
    '## 8. Copy list for mtgprint.net',
    '',
    '```',
    '1 Arcane Signet',
    '1 Command Tower',
    '7 Swamp',
    '```',
  ].join('\n');

  it('prefers the block under the copy-list heading', () => {
    expect(extractFromMarkdown(guide)?.trim().split('\n')).toEqual([
      '1 Arcane Signet',
      '1 Command Tower',
      '7 Swamp',
    ]);
  });

  it('is used automatically when parsing a guide', () => {
    const result = parseDecklist(guide);
    expect(result.fromMarkdownBlock).toBe(true);
    expect(totalCards(result.entries)).toBe(9);
  });

  it('falls back to the last decklist-shaped fence', () => {
    const text = '# Notes\n\n```\nsome prose here\n```\n\n```\n1 Sol Ring\n2 Island\n```';
    expect(extractFromMarkdown(text)?.trim()).toBe('1 Sol Ring\n2 Island');
  });

  it('returns null when no fence looks like a decklist', () => {
    expect(extractFromMarkdown('# Notes\n\n```\njust prose\n```')).toBeNull();
  });
});
