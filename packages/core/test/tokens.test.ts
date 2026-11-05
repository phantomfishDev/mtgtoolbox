import { describe, expect, it } from 'vitest';
import { addFoundTokens, readTokenRows, setTokensSection, tokenLine } from '../src/decklist/tokens.js';
import { bareSectionHeader, parseDecklist, selectForTokenMode } from '../src/decklist/parse.js';
import { findTokens, tokenPrintings } from '../src/scryfall/tokens.js';
import type { ScryfallClient } from '../src/scryfall/client.js';
import type { ScryfallCard } from '../src/scryfall/types.js';
import { card } from './helpers.js';

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

describe('zero-quantity token rows', () => {
  const list = ['Deck', '1 Sol Ring', '', 'Tokens', '0 Wraith (TLTC) 7', '4 Clue (TTRK) 1'].join('\n');

  it('parse under Tokens, and nowhere else', () => {
    const parsed = parseDecklist(list);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries.find((entry) => entry.name === 'Wraith')?.quantity).toBe(0);
    expect(parseDecklist('Deck\n0 Sol Ring').errors).toHaveLength(1);
  });

  it('are left out of every print mode', () => {
    const { entries } = parseDecklist(list);
    for (const mode of ['include', 'only'] as const) {
      expect(selectForTokenMode(entries, mode).map((entry) => entry.name)).not.toContain('Wraith');
    }
    expect(selectForTokenMode(entries, 'only').map((entry) => entry.name)).toEqual(['Clue']);
  });
});

describe('token rows', () => {
  it('round-trip through the section writer', () => {
    const rows = [
      { quantity: 9, name: 'Wraith', set: 'tltc', collectorNumber: '7' },
      { quantity: 0, name: 'Clue' },
    ];
    const text = setTokensSection('Deck\n1 Sol Ring\n', rows.map(tokenLine));
    expect(text).toContain('9 Wraith (TLTC) 7');
    expect(readTokenRows(text)).toEqual([
      { quantity: 9, name: 'Wraith', set: 'tltc', collectorNumber: '7' },
      { quantity: 0, name: 'Clue', set: undefined, collectorNumber: undefined },
    ]);
  });
});

describe('addFoundTokens', () => {
  const wraith = card({ name: 'Wraith', set: 'tltc', collector_number: '7', type_line: 'Token Creature — Wraith', power: '3', toughness: '3', color_identity: ['B'], oracle_text: 'Menace' });
  const otherWraithArt = { ...wraith, id: 'x', set: 'tltr', collector_number: '9' };
  const weakWraith = card({ name: 'Wraith', set: 'tm20', collector_number: '1', type_line: 'Token Creature — Wraith', power: '2', toughness: '2', color_identity: ['B'] });
  const clue = card({ name: 'Clue', set: 'ttrk', collector_number: '1', type_line: 'Token Artifact — Clue' });

  it('keeps quantities and order, and appends only what is new', () => {
    const rows = [{ quantity: 12, name: 'Wraith', set: 'tltr', collectorNumber: '9' }];
    const out = addFoundTokens(rows, [otherWraithArt], [{ card: wraith }, { card: clue }], 4);
    expect(out.added.map((found) => found.card.name)).toEqual(['Clue']);
    expect(out.rows).toEqual([
      { quantity: 12, name: 'Wraith', set: 'tltr', collectorNumber: '9' },
      { quantity: 4, name: 'Clue', set: 'ttrk', collectorNumber: '1' },
    ]);
  });

  it('does not bring back a token set to 0', () => {
    const rows = [{ quantity: 0, name: 'Clue', set: 'ttrk', collectorNumber: '1' }];
    expect(addFoundTokens(rows, [clue], [{ card: clue }], 4).added).toEqual([]);
  });

  it('tells apart tokens that share a name', () => {
    const rows = [{ quantity: 6, name: 'Wraith', set: 'tltc', collectorNumber: '7' }];
    const out = addFoundTokens(rows, [wraith], [{ card: wraith }, { card: weakWraith }], 2);
    expect(out.added.map((found) => found.card.power)).toEqual(['2']);
  });

  it('matches an unpinned row by name', () => {
    const rows = [{ quantity: 3, name: 'clue' }];
    expect(addFoundTokens(rows, [undefined], [{ card: clue }], 4).added).toEqual([]);
  });
});

describe('findTokens', () => {
  function stubClient(cards: ScryfallCard[]): ScryfallClient {
    const byId = new Map(cards.map((c) => [c.id, c]));
    return {
      collection: async (ids: { id: string }[]) => ({
        data: ids.map((id) => byId.get(id.id)).filter((c): c is ScryfallCard => c !== undefined),
        not_found: [],
      }),
    } as unknown as ScryfallClient;
  }
  const part = (target: ScryfallCard) => ({ id: target.id, object: 'related_card', component: 'token', name: target.name, type_line: target.type_line, uri: '' });

  it('collapses printings of one token and records every maker', async () => {
    const treasureA = card({ id: 'ta', name: 'Treasure', type_line: 'Token Artifact — Treasure', oracle_text: 'Sacrifice' });
    const treasureB = { ...treasureA, id: 'tb', set: 'other' };
    const makerA = card({ id: 'a', name: 'Smothering Tithe', all_parts: [part(treasureA)] });
    const makerB = card({ id: 'b', name: 'Dockside Extortionist', all_parts: [part(treasureB)] });
    const found = await findTokens([makerA, makerB], stubClient([treasureA, treasureB, makerA, makerB]));
    expect(found).toHaveLength(1);
    expect(found[0]?.madeBy).toEqual(['Dockside Extortionist', 'Smothering Tithe']);
  });

  it('finds nothing in a deck that makes no tokens', async () => {
    const ring = card({ id: 'r' });
    expect(await findTokens([ring], stubClient([ring]))).toEqual([]);
  });
});

describe('tokenPrintings', () => {
  const bear = (id: string, power: string) =>
    card({ id, name: 'Bear', layout: 'token', type_line: 'Token Creature — Bear', power, toughness: power });
  const client = (prints: ScryfallCard[], full: ScryfallCard[] = prints) =>
    ({
      prints: async (_name: string, options?: { extras?: boolean }) => (options?.extras ? prints : []),
      collection: async (ids: { id: string }[]) => ({
        data: full.filter((c) => ids.some((id) => id.id === c.id)),
        not_found: [],
      }),
    }) as unknown as ScryfallClient;

  it('offers only printings of the same token, asking for extras', async () => {
    const small = bear('a', '2');
    const options = await tokenPrintings(small, client([small, bear('b', '2'), bear('c', '4')]));
    expect(options.map((option) => option.id)).toEqual(['a', 'b']);
  });

  it('always includes the printing in use, even when search misses it', async () => {
    const only = bear('a', '2');
    expect((await tokenPrintings(only, client([]))).map((option) => option.id)).toEqual(['a']);
  });

  it('compares the full card, not a stored copy missing power and toughness', async () => {
    const full = bear('a', '2');
    const { power: _p, toughness: _t, ...stored } = full;
    const options = await tokenPrintings(stored as ScryfallCard, client([full, bear('b', '2'), bear('c', '4')]));
    expect(options.map((option) => option.id)).toEqual(['a', 'b']);
  });

  it('ignores a real card sharing the name', async () => {
    const token = bear('a', '2');
    const creature = card({ id: 'z', name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' });
    expect((await tokenPrintings(token, client([creature, token]))).map((option) => option.id)).toEqual(['a']);
  });
});
