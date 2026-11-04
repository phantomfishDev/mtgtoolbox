import { describe, expect, it } from 'vitest';
import { manaCurve, CURVE_CAP } from '../src/analysis/curve.js';
import { curveManaValue, hasLandBack, isLandCard, manaValueOf } from '../src/analysis/mana.js';
import type { ResolvedCard } from '../src/scryfall/resolve.js';
import { card } from './helpers.js';

const at = (name: string, quantity: number, over = {}): ResolvedCard => ({
  entry: { quantity, name, line: 1, raw: `${quantity} ${name}` },
  card: card({ name, ...over }),
  via: 'name',
});

describe('manaValueOf', () => {
  it('adds generic and coloured symbols', () => {
    expect(manaValueOf('{2}{W}{W}')).toBe(4);
    expect(manaValueOf('{B}')).toBe(1);
    expect(manaValueOf('')).toBe(0);
    expect(manaValueOf(undefined)).toBe(0);
  });

  it('counts X as zero', () => {
    expect(manaValueOf('{X}{B}{B}{B}')).toBe(3);
  });

  it('counts a hybrid or Phyrexian symbol as one', () => {
    expect(manaValueOf('{W/U}{W/U}')).toBe(2);
    expect(manaValueOf('{1}{W/P}')).toBe(2);
  });

  it('handles double-digit generic costs', () => {
    expect(manaValueOf('{12}')).toBe(12);
  });
});

describe('front-face reasoning', () => {
  it('treats a spell with a land back as a spell', () => {
    // Malakir Rebirth's combined type line reads "Instant // Land"; charting it
    // as a land would drop a one-mana instant out of the curve entirely.
    const mdfc = card({
      name: 'Malakir Rebirth',
      layout: 'modal_dfc',
      type_line: 'Instant // Land',
      cmc: 1,
      card_faces: [
        { name: 'Malakir Rebirth', type_line: 'Instant', mana_cost: '{B}' },
        { name: 'Malakir Mire', type_line: 'Land' },
      ],
    });
    expect(isLandCard(mdfc)).toBe(false);
    expect(hasLandBack(mdfc)).toBe(true);
    expect(curveManaValue(mdfc)).toBe(1);
  });

  it('still recognises a real land', () => {
    expect(isLandCard(card({ type_line: 'Basic Land — Swamp' }))).toBe(true);
    expect(isLandCard(card({ type_line: 'Land' }))).toBe(true);
    expect(hasLandBack(card({ type_line: 'Land' }))).toBe(false);
  });

  it('uses the front half of a split card, not the sum', () => {
    // Scryfall reports Dusk // Dawn as cmc 9, the two halves added together.
    const split = card({
      name: 'Dusk // Dawn',
      layout: 'split',
      type_line: 'Sorcery // Sorcery',
      cmc: 9,
      card_faces: [
        { name: 'Dusk', type_line: 'Sorcery', mana_cost: '{2}{W}{W}' },
        { name: 'Dawn', type_line: 'Sorcery', mana_cost: '{3}{W}{W}' },
      ],
    });
    expect(curveManaValue(split)).toBe(4);
  });

  it('uses the printed value for a transforming creature', () => {
    const dfc = card({
      layout: 'transform',
      cmc: 1,
      card_faces: [
        { name: 'Delver of Secrets', type_line: 'Creature — Human Wizard', mana_cost: '{U}' },
        { name: 'Insectile Aberration', type_line: 'Creature — Human Insect' },
      ],
    });
    expect(curveManaValue(dfc)).toBe(1);
  });
});

describe('manaCurve', () => {
  it('excludes lands and counts copies rather than distinct cards', () => {
    const curve = manaCurve([
      at('Swamp', 38, { type_line: 'Basic Land — Swamp', cmc: 0 }),
      at('Nazgul', 9, { cmc: 3, type_line: 'Creature — Wraith' }),
      at('Sol Ring', 1, { cmc: 1, type_line: 'Artifact' }),
    ]);
    expect(curve.lands).toBe(38);
    expect(curve.spells).toBe(10);
    expect(curve.buckets[3]?.count).toBe(9);
    expect(curve.buckets[1]?.count).toBe(1);
    // A land bar would dwarf everything, so zero stays empty here.
    expect(curve.buckets[0]?.count).toBe(0);
  });

  it('caps the top bucket', () => {
    const curve = manaCurve([
      at('Big', 1, { cmc: 9, type_line: 'Creature' }),
      at('Bigger', 1, { cmc: 12, type_line: 'Creature' }),
    ]);
    expect(curve.buckets).toHaveLength(CURVE_CAP + 1);
    expect(curve.buckets[CURVE_CAP]?.count).toBe(2);
    expect(curve.buckets[CURVE_CAP]?.label).toBe('7+');
  });

  it('averages over copies, not entries', () => {
    const curve = manaCurve([
      at('A', 3, { cmc: 1, type_line: 'Creature' }),
      at('B', 1, { cmc: 5, type_line: 'Creature' }),
    ]);
    expect(curve.spells).toBe(4);
    expect(curve.averageManaValue).toBeCloseTo((1 * 3 + 5) / 4, 6);
  });

  it('reports a peak for scaling a chart', () => {
    const curve = manaCurve([at('A', 7, { cmc: 2, type_line: 'Creature' })]);
    expect(curve.peak).toBe(7);
  });

  it('copes with a deck of nothing but lands', () => {
    const curve = manaCurve([at('Swamp', 38, { type_line: 'Basic Land — Swamp', cmc: 0 })]);
    expect(curve.spells).toBe(0);
    expect(curve.averageManaValue).toBe(0);
    expect(curve.peak).toBe(0);
  });
});

describe('curve caveats', () => {
  it('flags cost reduction', () => {
    const curve = manaCurve([
      at('Reducer', 1, { cmc: 3, type_line: 'Creature', oracle_text: 'Artifact spells you cast cost {1} less to cast.' }),
    ]);
    expect(curve.caveats.map((c) => c.code)).toContain('cost-reduction');
  });

  it('flags free casting', () => {
    const curve = manaCurve([
      at('Freebie', 1, { cmc: 2, type_line: 'Instant', oracle_text: 'You may cast it without paying its mana cost.' }),
    ]);
    expect(curve.caveats.map((c) => c.code)).toContain('free-cast');
  });

  it('flags X spells, whose printed value is only a floor', () => {
    const curve = manaCurve([
      at('Fireball', 1, { cmc: 1, mana_cost: '{X}{R}', type_line: 'Sorcery' }),
    ]);
    const caveat = curve.caveats.find((c) => c.code === 'x-spell');
    expect(caveat?.cards).toEqual(['Fireball']);
  });

  it('flags cards with a land on the back', () => {
    const curve = manaCurve([
      at('Malakir Rebirth', 1, {
        layout: 'modal_dfc',
        type_line: 'Instant // Land',
        cmc: 1,
        card_faces: [
          { name: 'Malakir Rebirth', type_line: 'Instant', mana_cost: '{B}' },
          { name: 'Malakir Mire', type_line: 'Land' },
        ],
      }),
    ]);
    expect(curve.caveats.map((c) => c.code)).toContain('land-back');
  });

  it('flags cascade and suspend', () => {
    const curve = manaCurve([
      at('Cascader', 1, { cmc: 4, type_line: 'Creature', keywords: ['Cascade'] }),
    ]);
    expect(curve.caveats.map((c) => c.code)).toContain('cascade-or-suspend');
  });

  it('names each card only once however many copies are run', () => {
    const curve = manaCurve([
      at('Fireball', 9, { cmc: 1, mana_cost: '{X}{R}', type_line: 'Sorcery' }),
    ]);
    expect(curve.caveats.find((c) => c.code === 'x-spell')?.cards).toEqual(['Fireball']);
  });

  it('says nothing when there is nothing to say', () => {
    const curve = manaCurve([at('Vanilla', 1, { cmc: 2, type_line: 'Creature' })]);
    expect(curve.caveats).toEqual([]);
  });
});

describe('tokens in the curve', () => {
  const token = (name: string, quantity: number): ResolvedCard => ({
    entry: { quantity, name, line: 1, raw: `${quantity} ${name}`, section: 'tokens' },
    card: card({ name, layout: 'token', type_line: 'Token Creature — Wraith', mana_cost: '' }),
    via: 'name',
  });

  it('ignores token entries entirely', () => {
    const spell = at('Counterspell', 1, { mana_cost: '{U}{U}', type_line: 'Instant' });
    const withTokens = manaCurve([spell, token('Wraith', 9)]);
    const without = manaCurve([spell]);
    expect(withTokens.spells).toBe(without.spells);
    expect(withTokens.averageManaValue).toBe(without.averageManaValue);
    expect(withTokens.buckets[0]?.count).toBe(0);
  });
});
