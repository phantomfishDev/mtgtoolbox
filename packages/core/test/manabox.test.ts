import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../src/collection/csv.js';
import {
  importManaboxCsv,
  parseManaboxCsv,
  toManaboxCsv,
} from '../src/collection/manabox.js';
import { addEntry } from '../src/collection/collection.js';
import { emptyCollection, type CollectionEntry } from '../src/collection/types.js';

const HEADER =
  'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,' +
  'Purchase price,Misprint,Altered,Condition,Language,Purchase price currency';

const row = (
  name: string,
  set: string,
  cn: string,
  foil = 'normal',
  quantity = '1',
  extra: Partial<{ scryfall: string; language: string }> = {},
): string =>
  [
    name,
    set,
    'Set Name',
    cn,
    foil,
    'rare',
    quantity,
    '',
    extra.scryfall ?? '',
    '0.42',
    'false',
    'false',
    'near_mint',
    extra.language ?? 'en',
    'EUR',
  ].join(',');

const csv = (...rows: string[]): string => [HEADER, ...rows].join('\n');

const entry = (over: Partial<CollectionEntry> = {}): CollectionEntry => ({
  name: 'Sol Ring',
  set: 'ltc',
  collectorNumber: '264',
  finish: 'nonfoil',
  quantity: 1,
  ...over,
});

describe('CSV reading', () => {
  it('reads quoted fields containing commas, quotes and newlines', () => {
    const rows = parseCsv('a,b\n"Fire // Ice, split","he said ""hi""\nagain"\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['Fire // Ice, split', 'he said "hi"\nagain'],
    ]);
  });

  it('handles CRLF, a byte-order mark and a missing final newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not invent a trailing row for a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
  });

  it('round-trips fields that need quoting', () => {
    const rows = [['plain', 'with,comma', 'with"quote', ' padded ']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('importing from ManaBox', () => {
  it('reads names, printings, quantities and finishes', () => {
    const { entries, rows } = parseManaboxCsv(
      csv(row('Sol Ring', 'LTC', '264', 'normal', '2'), row('Arcane Signet', 'ELD', '331', 'foil')),
    );
    expect(rows).toBe(2);
    expect(entries).toEqual([
      { name: 'Sol Ring', set: 'ltc', collectorNumber: '264', finish: 'nonfoil', quantity: 2 },
      { name: 'Arcane Signet', set: 'eld', collectorNumber: '331', finish: 'foil', quantity: 1 },
    ]);
  });

  it('keeps the Scryfall id and a non-English language', () => {
    const { entries } = parseManaboxCsv(
      csv(row('Sol Ring', 'LTC', '264', 'normal', '1', { scryfall: 'abc-123', language: 'ja' })),
    );
    expect(entries[0]).toMatchObject({ scryfallId: 'abc-123', language: 'ja' });
  });

  it('leaves English implicit', () => {
    const { entries } = parseManaboxCsv(csv(row('Sol Ring', 'LTC', '264')));
    expect(entries[0]).not.toHaveProperty('language');
  });

  it('accepts etched foils', () => {
    const { entries } = parseManaboxCsv(csv(row('Sol Ring', 'CMR', '1', 'etched')));
    expect(entries[0]?.finish).toBe('etched');
  });

  it('matches columns by name, in any order and any capitalisation', () => {
    const { entries } = parseManaboxCsv('Quantity,card name,Set_Code,Card Number\n3,Sol Ring,ltc,264');
    expect(entries[0]).toEqual({
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '264',
      finish: 'nonfoil',
      quantity: 3,
    });
  });

  it('tags each card with its binder', () => {
    const { entries } = parseManaboxCsv(
      'Name,Set code,Collector number,Binder Name\nSol Ring,ltc,264,Commander staples',
    );
    expect(entries[0]?.tags).toEqual(['Commander staples']);
  });

  it('reports unusable rows instead of guessing', () => {
    const { entries, skipped } = parseManaboxCsv(
      csv(
        row('Sol Ring', 'LTC', '264'),
        row('Mystery Card', '', '1'),
        row('Bad Count', 'LTC', '264', 'normal', 'lots'),
        row('Odd Finish', 'LTC', '264', 'shiny'),
      ),
    );
    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([
      { line: 3, reason: 'no set code', name: 'Mystery Card' },
      { line: 4, reason: 'quantity "lots" is not a positive whole number', name: 'Bad Count' },
      { line: 5, reason: 'unrecognised finish "shiny"', name: 'Odd Finish' },
    ]);
  });

  it('rejects a file that is not a card list at all', () => {
    expect(() => parseManaboxCsv('date,total\n2026-01-01,12')).toThrow(/does not look like a ManaBox export/);
  });

  it('rejects an empty file', () => {
    expect(() => parseManaboxCsv('')).toThrow(/empty/);
  });

  it('merges repeated printings and adds to what is already owned', () => {
    const owned = addEntry(emptyCollection(), entry({ quantity: 1 }));
    const { collection } = importManaboxCsv(
      owned,
      csv(row('Sol Ring', 'LTC', '264', 'normal', '2'), row('Sol Ring', 'LTC', '264', 'normal', '3')),
    );
    expect(collection.cards).toHaveLength(1);
    expect(collection.cards[0]?.quantity).toBe(6);
  });

  it('keeps foil, nonfoil and Japanese copies of one printing apart', () => {
    const { collection } = importManaboxCsv(
      emptyCollection(),
      csv(
        row('Sol Ring', 'LTC', '264', 'normal'),
        row('Sol Ring', 'LTC', '264', 'foil'),
        row('Sol Ring', 'LTC', '264', 'normal', '1', { language: 'ja' }),
      ),
    );
    expect(collection.cards).toHaveLength(3);
  });

  it('replaces the collection when asked to', () => {
    const owned = addEntry(emptyCollection(), entry({ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }));
    const { collection } = importManaboxCsv(owned, csv(row('Sol Ring', 'LTC', '264')), {
      mode: 'replace',
    });
    expect(collection.cards.map((card) => card.name)).toEqual(['Sol Ring']);
  });
});

describe('exporting to ManaBox', () => {
  it('writes ManaBox’s own header', () => {
    expect(toManaboxCsv(emptyCollection()).trim()).toBe(HEADER);
  });

  it('survives a round trip through the CSV', () => {
    let collection = emptyCollection();
    for (const card of [
      entry({ quantity: 2 }),
      entry({ finish: 'foil' }),
      entry({ name: 'Fire // Ice, the "split" one', set: 'apc', collectorNumber: '128' }),
      entry({ name: 'Sol Ring', language: 'ja', scryfallId: 'abc-123' }),
    ]) {
      collection = addEntry(collection, card);
    }

    const { collection: reimported, result } = importManaboxCsv(
      emptyCollection(),
      toManaboxCsv(collection),
    );
    expect(result.skipped).toEqual([]);
    expect(reimported.cards).toEqual(collection.cards);
  });
});
