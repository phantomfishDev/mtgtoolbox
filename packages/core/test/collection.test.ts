import { describe, expect, it } from 'vitest';
import {
  addEntry,
  collectionStats,
  findByName,
  ownedCount,
  removeEntry,
  searchCollection,
} from '../src/collection/collection.js';
import {
  compareCollectorNumbers,
  emptyCollection,
  frontName,
  normalizeName,
  parseCollection,
  sortEntries,
  type CollectionEntry,
} from '../src/collection/types.js';

const entry = (over: Partial<CollectionEntry> = {}): CollectionEntry => ({
  name: 'Sol Ring',
  set: 'ltc',
  collectorNumber: '264',
  finish: 'nonfoil',
  quantity: 1,
  ...over,
});

describe('collection entries', () => {
  it('merges added copies of the same printing and finish', () => {
    let collection = addEntry(emptyCollection(), entry({ quantity: 2 }));
    collection = addEntry(collection, entry({ quantity: 3 }));
    expect(collection.cards).toHaveLength(1);
    expect(collection.cards[0]?.quantity).toBe(5);
  });

  it('keeps foil and nonfoil copies apart', () => {
    let collection = addEntry(emptyCollection(), entry());
    collection = addEntry(collection, entry({ finish: 'foil' }));
    expect(collection.cards).toHaveLength(2);
    expect(ownedCount(collection, 'Sol Ring')).toBe(2);
  });

  it('keeps different printings of one card apart', () => {
    let collection = addEntry(emptyCollection(), entry());
    collection = addEntry(collection, entry({ set: 'cmm', collectorNumber: '1' }));
    expect(collection.cards).toHaveLength(2);
    expect(findByName(collection, 'sol ring')).toHaveLength(2);
  });

  it('removes a given number of copies', () => {
    const collection = addEntry(emptyCollection(), entry({ quantity: 4 }));
    const result = removeEntry(collection, entry(), 3);
    expect(result.removed).toBe(3);
    expect(result.collection.cards[0]?.quantity).toBe(1);
  });

  it('drops the entry when everything is removed', () => {
    const collection = addEntry(emptyCollection(), entry({ quantity: 2 }));
    const result = removeEntry(collection, entry());
    expect(result.removed).toBe(2);
    expect(result.collection.cards).toHaveLength(0);
  });

  it('clamps removal to what is actually held', () => {
    const collection = addEntry(emptyCollection(), entry({ quantity: 2 }));
    expect(removeEntry(collection, entry(), 99).removed).toBe(2);
  });

  it('searches names and tags', () => {
    const collection = addEntry(emptyCollection(), entry({ tags: ['edh-staple'] }));
    expect(searchCollection(collection, 'sol')).toHaveLength(1);
    expect(searchCollection(collection, 'STAPLE')).toHaveLength(1);
    expect(searchCollection(collection, 'nothing')).toHaveLength(0);
  });

  it('summarises the collection', () => {
    let collection = addEntry(emptyCollection(), entry({ quantity: 2 }));
    collection = addEntry(collection, entry({ name: 'Island', set: 'znr', collectorNumber: '1' }));
    const stats = collectionStats(collection);
    expect(stats.totalCards).toBe(3);
    expect(stats.distinctNames).toBe(2);
    expect(stats.bySet[0]).toEqual({ set: 'ltc', count: 2 });
  });
});

describe('name and number normalisation', () => {
  it('folds case and the curly apostrophe', () => {
    expect(normalizeName(' Praetors’ Voice ')).toBe("praetors' voice");
  });

  it('takes the front face of a double-faced name', () => {
    expect(frontName('Malakir Rebirth // Malakir Mire')).toBe('malakir rebirth');
    expect(frontName('Sol Ring')).toBe('sol ring');
  });

  it('sorts collector numbers numerically, not as strings', () => {
    expect(compareCollectorNumbers('9', '10')).toBeLessThan(0);
    expect(compareCollectorNumbers('123a', '123b')).toBeLessThan(0);
  });

  it('sorts entries by name then set then number', () => {
    const sorted = sortEntries([
      entry({ name: 'Sol Ring', set: 'ltc', collectorNumber: '10' }),
      entry({ name: 'Sol Ring', set: 'ltc', collectorNumber: '9' }),
      entry({ name: 'Arcane Signet' }),
    ]);
    expect(sorted.map((e) => `${e.name} ${e.collectorNumber}`)).toEqual([
      'Arcane Signet 264',
      'Sol Ring 9',
      'Sol Ring 10',
    ]);
  });
});

describe('parseCollection', () => {
  it('accepts a valid file and defaults the finish', () => {
    const parsed = parseCollection({
      version: 1,
      cards: [{ name: 'Sol Ring', set: 'LTC', collectorNumber: '264', quantity: 1 }],
    });
    expect(parsed.cards[0]?.finish).toBe('nonfoil');
    expect(parsed.cards[0]?.set).toBe('ltc');
  });

  it('names the offending card in the error', () => {
    expect(() =>
      parseCollection({
        version: 1,
        cards: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '264', quantity: 0 }],
      }),
    ).toThrow(/Sol Ring/);
  });

  it('rejects an unknown version rather than guessing', () => {
    expect(() => parseCollection({ version: 99, cards: [] })).toThrow(/invalid/);
  });
});
