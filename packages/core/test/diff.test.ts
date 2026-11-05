import { describe, expect, it } from 'vitest';
import { diffDeck, isBasicLand, unprintedOnly } from '../src/printed/diff.js';
import { addEntry } from '../src/printed/ledger.js';
import { emptyLedger, type PrintedEntry } from '../src/printed/types.js';
import type { ResolvedCard } from '../src/scryfall/resolve.js';
import type { DeckEntry } from '../src/decklist/parse.js';
import { card } from './helpers.js';

const deckEntry = (name: string, quantity: number): DeckEntry => ({
  quantity,
  name,
  line: 1,
  raw: `${quantity} ${name}`,
});

const resolved = (name: string, quantity: number, over = {}): ResolvedCard => ({
  entry: deckEntry(name, quantity),
  card: card({ name, ...over }),
  via: 'name',
});

const own = (over: Partial<PrintedEntry>): PrintedEntry => ({
  name: 'Sol Ring',
  set: 'tst',
  collectorNumber: '1',
  finish: 'nonfoil',
  quantity: 1,
  ...over,
});

describe('isBasicLand', () => {
  it('recognises basics, snow basics and Wastes', () => {
    expect(isBasicLand(card({ type_line: 'Basic Land — Swamp' }))).toBe(true);
    expect(isBasicLand(card({ type_line: 'Basic Snow Land — Forest' }))).toBe(true);
    expect(isBasicLand(card({ type_line: 'Basic Land' }))).toBe(true);
  });

  it('does not treat nonbasic lands as basics', () => {
    expect(isBasicLand(card({ type_line: 'Land — Island Swamp' }))).toBe(false);
    expect(isBasicLand(card({ type_line: 'Legendary Land' }))).toBe(false);
  });
});

describe('diffDeck', () => {
  it('reports everything missing against an empty collection', () => {
    const diff = diffDeck([resolved('Sol Ring', 1)], emptyLedger());
    expect(diff.totalToPrint).toBe(1);
    expect(diff.rows[0]?.printed).toBe(0);
  });

  it('counts partial ownership', () => {
    const collection = addEntry(emptyLedger(), own({ name: 'Brainstorm', quantity: 1 }));
    const diff = diffDeck([resolved('Brainstorm', 3)], collection);
    expect(diff.rows[0]).toMatchObject({ needed: 3, printed: 1, toPrint: 2 });
  });

  it('requires the exact printing by default, because the art is what was printed', () => {
    const ledger = addEntry(emptyLedger(), own({ set: 'cmm', collectorNumber: '99' }));
    const diff = diffDeck([resolved('Sol Ring', 1)], ledger);
    expect(diff.totalToPrint).toBe(1);
  });

  it('matches the exact printing it holds', () => {
    const ledger = addEntry(emptyLedger(), own({ set: 'tst', collectorNumber: '1' }));
    const diff = diffDeck([resolved('Sol Ring', 1, { set: 'tst', collector_number: '1' })], ledger);
    expect(diff.totalToPrint).toBe(0);
  });

  it('matches any printing once strictPrinting is turned off', () => {
    const ledger = addEntry(emptyLedger(), own({ set: 'cmm', collectorNumber: '99' }));
    const diff = diffDeck([resolved('Sol Ring', 1)], ledger, { strictPrinting: false });
    expect(diff.totalToPrint).toBe(0);
  });

  it('counts basics by default, because a proxy deck needs its basics printed', () => {
    const swamp = resolved('Swamp', 7, { type_line: 'Basic Land — Swamp' });
    expect(diffDeck([swamp], emptyLedger()).totalToPrint).toBe(7);
  });

  it('skips basics when assumeBasics is on', () => {
    const swamp = resolved('Swamp', 7, { type_line: 'Basic Land — Swamp' });
    const diff = diffDeck([swamp], emptyLedger(), { assumeBasics: true });
    expect(diff.totalToPrint).toBe(0);
  });

  it('does not let two rows claim the same printed sheet', () => {
    // One printed Sol Ring cannot satisfy two rows asking for that same art.
    const ledger = addEntry(emptyLedger(), own({ set: 'aaa', collectorNumber: '1', quantity: 1 }));
    const rows = [
      resolved('Sol Ring', 1, { set: 'aaa', collector_number: '1' }),
      resolved('Sol Ring', 1, { set: 'aaa', collector_number: '1' }),
    ];
    const diff = diffDeck(rows, ledger);
    expect(diff.totalPrinted).toBe(1);
    expect(diff.totalToPrint).toBe(1);
  });

  it('matches a front-face-only list against a full DFC name', () => {
    const collection = addEntry(
      emptyLedger(),
      own({ name: 'Malakir Rebirth // Malakir Mire' }),
    );
    const diff = diffDeck([resolved('Malakir Rebirth', 1)], collection);
    expect(diff.totalToPrint).toBe(0);
  });
});

describe('missingOnly', () => {
  it('keeps only the copies that are missing', () => {
    const collection = addEntry(emptyLedger(), own({ name: 'Brainstorm', quantity: 1 }));
    const rows = [resolved('Brainstorm', 3)];
    const trimmed = unprintedOnly(rows, diffDeck(rows, collection));
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]?.entry.quantity).toBe(2);
  });

  it('keeps rows separate when several share one printing', () => {
    // Nine copies of a card each listed on their own row: if rows were keyed by
    // printing rather than position they would collide and share one count.
    const rows = [resolved('Nazgul', 1), resolved('Nazgul', 1), resolved('Nazgul', 1)];
    const collection = addEntry(emptyLedger(), own({ name: 'Nazgul', quantity: 1 }));
    const diff = diffDeck(rows, collection);
    expect(diff.totalPrinted).toBe(1);
    // One copy is covered, so exactly two rows survive.
    expect(unprintedOnly(rows, diff)).toHaveLength(2);
  });

  it('drops rows that are fully owned', () => {
    const collection = addEntry(emptyLedger(), own({ name: 'Brainstorm', quantity: 4 }));
    const rows = [resolved('Brainstorm', 2)];
    expect(unprintedOnly(rows, diffDeck(rows, collection))).toHaveLength(0);
  });
});
