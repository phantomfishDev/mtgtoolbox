import { describe, expect, it } from 'vitest';
import {
  addEntries,
  addEntry,
  findByName,
  printedCount,
  removeEntry,
} from '../src/printed/ledger.js';
import {
  compareCollectorNumbers,
  emptyLedger,
  frontName,
  normalizeName,
  parsePrinted,
  sortEntries,
  type PrintedEntry,
} from '../src/printed/types.js';

const entry = (over: Partial<PrintedEntry> = {}): PrintedEntry => ({
  name: 'Sol Ring',
  set: 'ltc',
  collectorNumber: '264',
  finish: 'nonfoil',
  quantity: 1,
  ...over,
});

describe('printed ledger entries', () => {
  it('merges added copies of the same printing and finish', () => {
    let ledger = addEntry(emptyLedger(), entry({ quantity: 2 }));
    ledger = addEntry(ledger, entry({ quantity: 3 }));
    expect(ledger.cards).toHaveLength(1);
    expect(ledger.cards[0]?.quantity).toBe(5);
  });

  it('keeps foil and nonfoil copies apart', () => {
    let ledger = addEntry(emptyLedger(), entry());
    ledger = addEntry(ledger, entry({ finish: 'foil' }));
    expect(ledger.cards).toHaveLength(2);
    expect(printedCount(ledger, 'Sol Ring')).toBe(2);
  });

  it('keeps different printings of one card apart', () => {
    let ledger = addEntry(emptyLedger(), entry());
    ledger = addEntry(ledger, entry({ set: 'cmm', collectorNumber: '1' }));
    expect(ledger.cards).toHaveLength(2);
    expect(findByName(ledger, 'sol ring')).toHaveLength(2);
  });

  it('removes a given number of copies', () => {
    const ledger = addEntry(emptyLedger(), entry({ quantity: 4 }));
    const result = removeEntry(ledger, entry(), 3);
    expect(result.removed).toBe(3);
    expect(result.ledger.cards[0]?.quantity).toBe(1);
  });

  it('drops the entry when everything is removed', () => {
    const ledger = addEntry(emptyLedger(), entry({ quantity: 2 }));
    const result = removeEntry(ledger, entry());
    expect(result.removed).toBe(2);
    expect(result.ledger.cards).toHaveLength(0);
  });

  it('clamps removal to what is actually held', () => {
    const ledger = addEntry(emptyLedger(), entry({ quantity: 2 }));
    expect(removeEntry(ledger, entry(), 99).removed).toBe(2);
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

describe('parsePrinted', () => {
  it('accepts a valid file and defaults the finish', () => {
    const parsed = parsePrinted({
      version: 1,
      cards: [{ name: 'Sol Ring', set: 'LTC', collectorNumber: '264', quantity: 1 }],
    });
    expect(parsed.cards[0]?.finish).toBe('nonfoil');
    expect(parsed.cards[0]?.set).toBe('ltc');
  });

  it('names the offending card in the error', () => {
    expect(() =>
      parsePrinted({
        version: 1,
        cards: [{ name: 'Sol Ring', set: 'ltc', collectorNumber: '264', quantity: 0 }],
      }),
    ).toThrow(/Sol Ring/);
  });

  it('rejects an unknown version rather than guessing', () => {
    expect(() => parsePrinted({ version: 99, cards: [] })).toThrow(/invalid/);
  });
});
