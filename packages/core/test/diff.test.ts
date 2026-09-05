import { describe, expect, it } from 'vitest';
import { diffDeck, isBasicLand, missingOnly } from '../src/collection/diff.js';
import { addEntry } from '../src/collection/collection.js';
import { emptyCollection, type CollectionEntry } from '../src/collection/types.js';
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

const own = (over: Partial<CollectionEntry>): CollectionEntry => ({
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
    const diff = diffDeck([resolved('Sol Ring', 1)], emptyCollection());
    expect(diff.totalMissing).toBe(1);
    expect(diff.rows[0]?.owned).toBe(0);
  });

  it('counts partial ownership', () => {
    const collection = addEntry(emptyCollection(), own({ name: 'Brainstorm', quantity: 1 }));
    const diff = diffDeck([resolved('Brainstorm', 3)], collection);
    expect(diff.rows[0]).toMatchObject({ needed: 3, owned: 1, missing: 2 });
  });

  it('matches any printing by default', () => {
    const collection = addEntry(emptyCollection(), own({ set: 'cmm', collectorNumber: '99' }));
    const diff = diffDeck([resolved('Sol Ring', 1)], collection);
    expect(diff.totalMissing).toBe(0);
  });

  it('requires the exact printing under strictPrinting', () => {
    const collection = addEntry(emptyCollection(), own({ set: 'cmm', collectorNumber: '99' }));
    const diff = diffDeck([resolved('Sol Ring', 1)], collection, { strictPrinting: true });
    expect(diff.totalMissing).toBe(1);
  });

  it('treats basics as owned by default', () => {
    const swamp = resolved('Swamp', 7, { type_line: 'Basic Land — Swamp' });
    expect(diffDeck([swamp], emptyCollection()).totalMissing).toBe(0);
  });

  it('counts basics when assumeBasics is off', () => {
    const swamp = resolved('Swamp', 7, { type_line: 'Basic Land — Swamp' });
    const diff = diffDeck([swamp], emptyCollection(), { assumeBasics: false });
    expect(diff.totalMissing).toBe(7);
  });

  it('does not let two rows claim the same physical copy', () => {
    // One owned Sol Ring cannot satisfy two separate printings of it.
    const collection = addEntry(emptyCollection(), own({ quantity: 1 }));
    const rows = [
      resolved('Sol Ring', 1, { set: 'aaa', collector_number: '1' }),
      resolved('Sol Ring', 1, { set: 'bbb', collector_number: '2' }),
    ];
    const diff = diffDeck(rows, collection);
    expect(diff.totalOwned).toBe(1);
    expect(diff.totalMissing).toBe(1);
  });

  it('matches a front-face-only list against a full DFC name', () => {
    const collection = addEntry(
      emptyCollection(),
      own({ name: 'Malakir Rebirth // Malakir Mire' }),
    );
    const diff = diffDeck([resolved('Malakir Rebirth', 1)], collection);
    expect(diff.totalMissing).toBe(0);
  });
});

describe('missingOnly', () => {
  it('keeps only the copies that are missing', () => {
    const collection = addEntry(emptyCollection(), own({ name: 'Brainstorm', quantity: 1 }));
    const rows = [resolved('Brainstorm', 3)];
    const trimmed = missingOnly(rows, diffDeck(rows, collection));
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]?.entry.quantity).toBe(2);
  });

  it('keeps rows separate when several share one printing', () => {
    // Nine copies of a card each listed on their own row: if rows were keyed by
    // printing rather than position they would collide and share one count.
    const rows = [resolved('Nazgul', 1), resolved('Nazgul', 1), resolved('Nazgul', 1)];
    const collection = addEntry(emptyCollection(), own({ name: 'Nazgul', quantity: 1 }));
    const diff = diffDeck(rows, collection);
    expect(diff.totalOwned).toBe(1);
    // One copy is covered, so exactly two rows survive.
    expect(missingOnly(rows, diff)).toHaveLength(2);
  });

  it('drops rows that are fully owned', () => {
    const collection = addEntry(emptyCollection(), own({ name: 'Brainstorm', quantity: 4 }));
    const rows = [resolved('Brainstorm', 2)];
    expect(missingOnly(rows, diffDeck(rows, collection))).toHaveLength(0);
  });
});
