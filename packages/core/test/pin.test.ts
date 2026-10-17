import { describe, expect, it } from 'vitest';
import { applyPins, parseDecklist, readPins, setPinInDecklist } from '../src/index.js';

const DECK = `# Beorn Bears — a note about the deck.
#   indented comment line

Commander
1 Beorn the Fierce (HOB) 119

Deck
1 Arcane Signet
26 Forest (HOB) 198
1 Ayula, Queen Among Bears
1 Beorn, Reluctant Host
`;

describe('readPins', () => {
  it('reads the printings a list already names', () => {
    expect(readPins(DECK)).toEqual({
      'beorn the fierce': { set: 'hob', collectorNumber: '119' },
      forest: { set: 'hob', collectorNumber: '198' },
    });
  });

  it('ignores comment lines that look like card lines', () => {
    expect(readPins('# 1 Sol Ring (LTC) 284\n')).toEqual({});
  });
});

describe('setPinInDecklist', () => {
  it('adds a printing to a card that had none', () => {
    const out = setPinInDecklist(DECK, 'Arcane Signet', { set: 'pip', collectorNumber: '224' });
    expect(out).toContain('1 Arcane Signet (PIP) 224');
  });

  it('replaces a printing that was already there', () => {
    const out = setPinInDecklist(DECK, 'Forest', { set: 'ltr', collectorNumber: '280' });
    expect(out).toContain('26 Forest (LTR) 280');
    expect(out).not.toContain('HOB) 198');
  });

  it('clears a printing when passed null, keeping the quantity', () => {
    const out = setPinInDecklist(DECK, 'Forest', null);
    expect(out).toContain('\n26 Forest\n');
  });

  it('matches names case- and curly-quote-insensitively', () => {
    const out = setPinInDecklist(DECK, 'ayula, QUEEN among bears', {
      set: 'h1r',
      collectorNumber: '19',
    });
    expect(out).toContain('1 Ayula, Queen Among Bears (H1R) 19');
  });

  it('leaves every other line byte for byte', () => {
    const out = setPinInDecklist(DECK, 'Arcane Signet', { set: 'pip', collectorNumber: '224' });
    const before = DECK.split('\n');
    const after = out.split('\n');
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      if (before[i] === '1 Arcane Signet') continue;
      expect(after[i]).toBe(before[i]);
    }
  });

  it('does not touch a card the deck does not run', () => {
    expect(setPinInDecklist(DECK, 'Sol Ring', { set: 'ltc', collectorNumber: '284' })).toBe(DECK);
  });

  it('never rewrites a comment, even one naming the card', () => {
    const text = '# 1 Forest (XYZ) 1\n1 Forest\n';
    expect(setPinInDecklist(text, 'Forest', { set: 'hob', collectorNumber: '198' })).toBe(
      '# 1 Forest (XYZ) 1\n1 Forest (HOB) 198\n',
    );
  });

  it('keeps a trailing comment on the line it edits', () => {
    const text = '1 Forest # the good one\n';
    expect(setPinInDecklist(text, 'Forest', { set: 'hob', collectorNumber: '198' })).toBe(
      '1 Forest (HOB) 198 # the good one\n',
    );
  });

  it('preserves CRLF line endings', () => {
    const text = 'Deck\r\n1 Forest\r\n';
    expect(setPinInDecklist(text, 'Forest', { set: 'hob', collectorNumber: '198' })).toBe(
      'Deck\r\n1 Forest (HOB) 198\r\n',
    );
  });

  it('round-trips through the parser', () => {
    const out = setPinInDecklist(DECK, 'Arcane Signet', { set: 'pip', collectorNumber: '224' });
    const entry = parseDecklist(out).entries.find((e) => e.name === 'Arcane Signet');
    expect(entry).toMatchObject({ set: 'pip', collectorNumber: '224', quantity: 1 });
  });

  it('is what readPins reads back', () => {
    const out = setPinInDecklist(DECK, 'Arcane Signet', { set: 'pip', collectorNumber: '224' });
    expect(readPins(out)['arcane signet']).toEqual({ set: 'pip', collectorNumber: '224' });
  });
});

describe('applyPins', () => {
  it('applies a whole map and leaves unmentioned cards alone', () => {
    const out = applyPins(DECK, {
      'arcane signet': { set: 'pip', collectorNumber: '224' },
      forest: { set: 'ltr', collectorNumber: '280' },
    });
    expect(out).toContain('1 Arcane Signet (PIP) 224');
    expect(out).toContain('26 Forest (LTR) 280');
    expect(out).toContain('1 Beorn, Reluctant Host\n');
  });

  it('is a no-op when the list already says exactly this', () => {
    expect(applyPins(DECK, readPins(DECK))).toBe(DECK);
  });

  it('clears a printing the list names when the overlay says null', () => {
    // Absence means "leave it alone", so an explicit null is the only way to
    // undo a pin that is written into the file.
    const out = applyPins(DECK, { forest: null });
    expect(out).toContain('\n26 Forest\n');
    expect(out).toContain('1 Beorn the Fierce (HOB) 119');
  });

  it('round-trips a set then a clear back to the original list', () => {
    const set = applyPins(DECK, { 'arcane signet': { set: 'pip', collectorNumber: '224' } });
    expect(applyPins(set, { 'arcane signet': null })).toBe(DECK);
  });
});
