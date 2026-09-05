import { describe, expect, it } from 'vitest';
import {
  BRACKET_NAMES,
  assessBracket,
  isExtraTurn,
  isGameChanger,
  isMassLandDenial,
} from '../src/analysis/bracket.js';
import type { ResolvedCard } from '../src/scryfall/resolve.js';
import { card } from './helpers.js';

const at = (name: string, quantity = 1, over = {}): ResolvedCard => ({
  entry: { quantity, name, line: 1, raw: `${quantity} ${name}` },
  card: card({ name, ...over }),
  via: 'name',
});

const vanilla = (name: string) => at(name, 1, { type_line: 'Creature — Bear', oracle_text: '' });

describe('card detection', () => {
  it('reads Game Changers off Scryfall rather than a hardcoded list', () => {
    expect(isGameChanger(card({ game_changer: true }))).toBe(true);
    expect(isGameChanger(card({ game_changer: false }))).toBe(false);
    // Absent on most cards; absence must not read as true.
    expect(isGameChanger(card())).toBe(false);
  });

  it('recognises unambiguous mass land denial', () => {
    expect(isMassLandDenial(card({ oracle_text: 'Destroy all lands.' }))).toBe(true);
    expect(
      isMassLandDenial(card({ oracle_text: 'Each player sacrifices two lands.' })),
    ).toBe(true);
    expect(isMassLandDenial(card({ oracle_text: "Lands don't untap during their controllers' untap steps." }))).toBe(true);
  });

  it('does not call ordinary land removal mass denial', () => {
    // Narrow by design: a false bracket 4 is worse than a missed signal.
    expect(isMassLandDenial(card({ oracle_text: 'Destroy target land.' }))).toBe(false);
    expect(isMassLandDenial(card({ oracle_text: 'Search your library for a land card.' }))).toBe(false);
    expect(isMassLandDenial(card({ oracle_text: 'Destroy all creatures.' }))).toBe(false);
  });

  it('recognises extra-turn spells', () => {
    expect(isExtraTurn(card({ oracle_text: 'Take an extra turn after this one.' }))).toBe(true);
    expect(isExtraTurn(card({ oracle_text: 'Target player takes an extra turn after this one.' }))).toBe(true);
    expect(isExtraTurn(card({ oracle_text: 'Untap all creatures you control.' }))).toBe(false);
  });

  it('reads oracle text from both faces', () => {
    const dfc = card({
      oracle_text: '',
      card_faces: [
        { name: 'Front', type_line: 'Creature', oracle_text: 'Flying.' },
        { name: 'Back', type_line: 'Sorcery', oracle_text: 'Destroy all lands.' },
      ],
    });
    expect(isMassLandDenial(dfc)).toBe(true);
  });
});

describe('assessBracket', () => {
  it('puts an unremarkable deck at 2, not 1', () => {
    // Bracket 1 is a statement of intent, so it is never inferred from cards.
    const result = assessBracket([vanilla('Bear'), vanilla('Elk')]);
    expect(result.bracket).toBe(2);
    expect(result.name).toBe('Core');
    expect(result.signals).toEqual([]);
  });

  it('moves to 3 for up to three Game Changers', () => {
    const result = assessBracket([
      at('Rhystic Study', 1, { game_changer: true }),
      at('Smothering Tithe', 1, { game_changer: true }),
      vanilla('Bear'),
    ]);
    expect(result.bracket).toBe(3);
    expect(result.signals[0]?.cards).toEqual(['Rhystic Study', 'Smothering Tithe']);
  });

  it('moves to 4 past three Game Changers', () => {
    const result = assessBracket(
      ['A', 'B', 'C', 'D'].map((n) => at(n, 1, { game_changer: true })),
    );
    expect(result.bracket).toBe(4);
    expect(result.signals[0]?.explanation).toMatch(/at most three/);
  });

  it('moves to 4 on mass land denial', () => {
    const result = assessBracket([
      vanilla('Bear'),
      at('Armageddon', 1, { oracle_text: 'Destroy all lands.' }),
    ]);
    expect(result.bracket).toBe(4);
    expect(result.signals.map((s) => s.code)).toContain('mass-land-denial');
  });

  it('treats a single extra-turn card as compatible with bracket 2', () => {
    const result = assessBracket([
      vanilla('Bear'),
      at('Time Warp', 1, { oracle_text: 'Take an extra turn after this one.' }),
    ]);
    expect(result.bracket).toBe(2);
    expect(result.signals.map((s) => s.code)).toContain('extra-turns');
  });

  it('reads three or more extra-turn cards as chaining', () => {
    const result = assessBracket(
      ['Time Warp', 'Temporal Manipulation', 'Capture of Jingzhou'].map((n) =>
        at(n, 1, { oracle_text: 'Take an extra turn after this one.' }),
      ),
    );
    expect(result.bracket).toBe(4);
  });

  it('takes the highest signal, not the sum', () => {
    const result = assessBracket([
      at('Rhystic Study', 1, { game_changer: true }),
      at('Armageddon', 1, { oracle_text: 'Destroy all lands.' }),
    ]);
    expect(result.bracket).toBe(4);
    expect(result.signals).toHaveLength(2);
  });

  it('counts a card once however many copies are run', () => {
    const result = assessBracket([at('Rhystic Study', 9, { game_changer: true })]);
    expect(result.signals[0]?.cards).toEqual(['Rhystic Study']);
    expect(result.bracket).toBe(3);
  });

  it('never assigns bracket 5 from a decklist alone', () => {
    const result = assessBracket(
      Array.from({ length: 20 }, (_, i) => at(`GC${i}`, 1, { game_changer: true })),
    );
    expect(result.bracket).toBeLessThanOrEqual(4);
  });

  it('always says what it could not check', () => {
    const result = assessBracket([vanilla('Bear')]);
    expect(result.unchecked.join(' ')).toMatch(/infinite combo/i);
    expect(result.unchecked.join(' ')).toMatch(/cEDH/);
  });

  it('names every bracket', () => {
    expect(Object.keys(BRACKET_NAMES)).toHaveLength(5);
    expect(BRACKET_NAMES[4]).toBe('Optimized');
  });
});
