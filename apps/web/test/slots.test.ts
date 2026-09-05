import { describe, expect, it } from 'vitest';
import { distinctArtworks, expand, slotsToCards } from '../src/resolve.js';
import type { Overrides } from '../src/session.js';
import type { DeckEntry, ResolvedCard, ScryfallCard } from '@mtgproxy/core';

function card(over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: over.id ?? `${over.set ?? 'tst'}-${over.collector_number ?? '1'}`,
    name: 'Nazgul',
    lang: 'en',
    layout: 'normal',
    released_at: '2023-06-23',
    set: 'ltr',
    set_name: 'Tales of Middle-earth',
    set_type: 'expansion',
    collector_number: '1',
    rarity: 'uncommon',
    type_line: 'Creature — Wraith',
    full_art: false,
    border_color: 'black',
    frame: '2015',
    promo: false,
    digital: false,
    image_status: 'highres_scan',
    ...over,
  };
}

const entry = (name: string, quantity: number): DeckEntry => ({
  quantity,
  name,
  line: 1,
  raw: `${quantity} ${name}`,
});

const resolved = (name: string, quantity: number, c?: ScryfallCard): ResolvedCard => ({
  entry: entry(name, quantity),
  card: c ?? card({ name }),
  via: 'name',
});

describe('expand', () => {
  it('keeps an unsplit entry as one slot covering every copy', () => {
    const slots = expand([resolved('Nazgul', 9)], {});
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ quantity: 9, copyIndex: null, totalCopies: 9 });
  });

  it('applies a shared override to the whole entry', () => {
    const chosen = card({ collector_number: '332' });
    const overrides: Overrides = { nazgul: { all: chosen } };
    const slots = expand([resolved('Nazgul', 9)], overrides);
    expect(slots[0]?.card.collector_number).toBe('332');
    expect(slots[0]?.quantity).toBe(9);
  });

  it('splits into one slot per copy', () => {
    const overrides: Overrides = { nazgul: { copies: Array.from({ length: 9 }, () => null) } };
    const slots = expand([resolved('Nazgul', 9)], overrides);
    expect(slots).toHaveLength(9);
    expect(slots.every((slot) => slot.quantity === 1)).toBe(true);
    expect(slots.map((slot) => slot.copyIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('gives each split copy its own printing', () => {
    const overrides: Overrides = {
      nazgul: {
        copies: [card({ collector_number: '332' }), card({ collector_number: '333' }), null],
      },
    };
    const slots = expand([resolved('Nazgul', 3)], overrides);
    expect(slots.map((slot) => slot.card.collector_number)).toEqual(['332', '333', '1']);
  });

  it('falls back to the shared printing for copies not chosen', () => {
    const overrides: Overrides = {
      nazgul: { all: card({ collector_number: '999' }), copies: [null, null] },
    };
    const slots = expand([resolved('Nazgul', 2)], overrides);
    expect(slots.map((slot) => slot.card.collector_number)).toEqual(['999', '999']);
  });

  it('leaves other cards untouched', () => {
    const overrides: Overrides = { nazgul: { copies: [null, null] } };
    const slots = expand([resolved('Nazgul', 2), resolved('Sol Ring', 1)], overrides);
    expect(slots).toHaveLength(3);
    expect(slots[2]).toMatchObject({ copyIndex: null, quantity: 1 });
  });
});

describe('slotsToCards', () => {
  it('preserves order and totals so a diff lines up by index', () => {
    const overrides: Overrides = { nazgul: { copies: [null, null, null] } };
    const slots = expand([resolved('Nazgul', 3), resolved('Sol Ring', 2)], overrides);
    const cards = slotsToCards(slots);
    expect(cards).toHaveLength(slots.length);
    expect(cards.reduce((sum, c) => sum + c.entry.quantity, 0)).toBe(5);
    cards.forEach((c, index) => expect(c.card.id).toBe(slots[index]!.card.id));
  });
});

describe('distinctArtworks', () => {
  const art = (id: string, cn: string) => card({ illustration_id: id, collector_number: cn, id: `c-${cn}` });

  it('picks one printing per artwork', () => {
    // Two printings share art A; only one of them should be used.
    const pool = [art('A', '723'), art('A', '332'), art('B', '724'), art('C', '725')];
    const { chosen, distinct } = distinctArtworks(pool, 3);
    expect(distinct).toBe(3);
    expect(new Set(chosen.map((c) => c.illustration_id)).size).toBe(3);
  });

  it('reports how many distinct artworks it actually found', () => {
    // Nine copies but only two artworks: the caller needs to know, so it can
    // explain the repeats rather than looking like it silently duplicated.
    const pool = [art('A', '1'), art('B', '2')];
    const { chosen, distinct } = distinctArtworks(pool, 9);
    expect(chosen).toHaveLength(9);
    expect(distinct).toBe(2);
  });

  it('cycles rather than leaving copies unassigned', () => {
    const pool = [art('A', '1'), art('B', '2')];
    const { chosen } = distinctArtworks(pool, 5);
    expect(chosen.map((c) => c.illustration_id)).toEqual(['A', 'B', 'A', 'B', 'A']);
  });

  it('falls back to the card id when a printing has no artwork id', () => {
    const pool = [card({ id: 'x', collector_number: '1' }), card({ id: 'y', collector_number: '2' })];
    expect(distinctArtworks(pool, 2).distinct).toBe(2);
  });

  it('returns nothing for an empty pool', () => {
    expect(distinctArtworks([], 4)).toEqual({ chosen: [], distinct: 0 });
  });
});
