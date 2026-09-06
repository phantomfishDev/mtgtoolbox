import { describe, expect, it } from 'vitest';
import {
  buildDeckData,
  ownedFingerprint,
  refreshDeckData,
  profileFingerprint,
  resolveFromDeckData,
  trimCard,
} from '../src/deckdata/build.js';
import { parseDeckData, DECK_DATA_VERSION } from '../src/deckdata/types.js';
import type { ResolvedCard } from '../src/scryfall/resolve.js';
import type { DeckEntry } from '../src/decklist/parse.js';
import type { PreferenceProfile } from '../src/printing/profile.js';
import { card } from './helpers.js';

const entry = (name: string, quantity = 1): DeckEntry => ({
  quantity,
  name,
  line: 1,
  raw: `${quantity} ${name}`,
});

const at = (name: string, quantity = 1, over = {}): ResolvedCard => ({
  entry: entry(name, quantity),
  card: card({ name, ...over }),
  via: 'name',
});

const profile: PreferenceProfile = { fullArt: 'prefer', preferOwned: true };

describe('profileFingerprint', () => {
  it('is stable for the same profile', () => {
    expect(profileFingerprint(profile)).toBe(profileFingerprint({ ...profile }));
  });

  it('ignores key order', () => {
    expect(profileFingerprint({ fullArt: 'prefer', preferOwned: true })).toBe(
      profileFingerprint({ preferOwned: true, fullArt: 'prefer' }),
    );
  });

  it('sees a change nested inside the basics sub-policy', () => {
    // The previous implementation filtered nested keys to the top-level key
    // list, so a difference in here could vanish and two unlike profiles would
    // wrongly share stored card data.
    const a: PreferenceProfile = { basics: { borderless: 'prefer' } };
    const b: PreferenceProfile = { basics: { borderless: 'avoid' } };
    expect(profileFingerprint(a)).not.toBe(profileFingerprint(b));
  });

  it('ignores nested key order too', () => {
    const a: PreferenceProfile = { basics: { fullArt: 'prefer', preferSets: ['hob'] } };
    const b: PreferenceProfile = { basics: { preferSets: ['hob'], fullArt: 'prefer' } };
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
  });

  it('respects array order, which is meaningful for preferSets', () => {
    expect(profileFingerprint({ preferSets: ['a', 'b'] })).not.toBe(
      profileFingerprint({ preferSets: ['b', 'a'] }),
    );
  });

  it('changes when a rule changes', () => {
    expect(profileFingerprint({ ...profile, fullArt: 'avoid' })).not.toBe(
      profileFingerprint(profile),
    );
  });
});

describe('trimCard', () => {
  it('keeps the fields the project reads', () => {
    const trimmed = trimCard(
      card({ name: 'Sol Ring', cmc: 1, game_changer: true, illustration_id: 'art-1' }),
    );
    expect(trimmed).toMatchObject({ name: 'Sol Ring', cmc: 1, game_changer: true });
    expect(trimmed.illustration_id).toBe('art-1');
  });

  it('keeps only the image sizes that get used', () => {
    const trimmed = trimCard(
      card({
        image_uris: {
          png: 'p',
          large: 'l',
          normal: 'n',
          small: 's',
          art_crop: 'a',
          border_crop: 'b',
        },
      }),
    );
    expect(trimmed.image_uris).toEqual({ png: 'p', large: 'l', normal: 'n' });
  });

  it('drops fields nothing reads', () => {
    const trimmed = trimCard(card({ rulings_uri: 'x', prices: { usd: '1' } } as never));
    expect('rulings_uri' in trimmed).toBe(false);
    expect('prices' in trimmed).toBe(false);
  });

  it('trims faces too', () => {
    const trimmed = trimCard(
      card({
        card_faces: [
          { name: 'Front', type_line: 'Instant', mana_cost: '{B}', image_uris: { png: 'p', small: 's' } },
          { name: 'Back', type_line: 'Land' },
        ],
      }),
    );
    expect(trimmed.card_faces?.[0]?.image_uris).toEqual({ png: 'p', large: undefined, normal: undefined });
    expect(trimmed.card_faces?.[1]?.name).toBe('Back');
  });
});

describe('buildDeckData', () => {
  it('stores one card per distinct printing, not per copy', () => {
    const data = buildDeckData('rats', [at('Rat Colony', 25)], profile);
    expect(data.cards).toHaveLength(1);
    expect(data.chosen['rat colony']).toBe(data.cards[0]?.id);
  });

  it('records the profile that chose the printings', () => {
    const data = buildDeckData('rats', [at('Sol Ring')], profile);
    expect(data.profile).toBe(profileFingerprint(profile));
  });

  it('sorts its output so regenerating an unchanged deck produces no diff', () => {
    const cards = [at('Zebra', 1, { id: 'z' }), at('Aardvark', 1, { id: 'a' })];
    const first = buildDeckData('d', cards, profile);
    const second = buildDeckData('d', [...cards].reverse(), profile);
    expect(first.cards.map((c) => c.id)).toEqual(second.cards.map((c) => c.id));
    expect(Object.keys(first.chosen)).toEqual(Object.keys(second.chosen));
  });

  it('round-trips through validation', () => {
    const data = buildDeckData('rats', [at('Sol Ring')], profile);
    const parsed = parseDeckData(JSON.parse(JSON.stringify(data)));
    expect(parsed.cards[0]?.name).toBe('Sol Ring');
    expect(parsed.version).toBe(DECK_DATA_VERSION);
  });
});

describe('ownedFingerprint', () => {
  it('is null when preferOwned is off, so the collection is not part of the key', () => {
    expect(ownedFingerprint({ preferOwned: false }, new Set(['a']))).toBeNull();
  });

  it('changes with what is owned when preferOwned is on', () => {
    const none = ownedFingerprint({ preferOwned: true }, new Set());
    const some = ownedFingerprint({ preferOwned: true }, new Set(['ltc|264']));
    expect(none).not.toBe(some);
  });

  it('does not depend on collection ordering', () => {
    expect(ownedFingerprint({ preferOwned: true }, new Set(['a', 'b']))).toBe(
      ownedFingerprint({ preferOwned: true }, new Set(['b', 'a'])),
    );
  });
});

describe('refreshDeckData', () => {
  const original = buildDeckData('deck', [at('Sol Ring', 1, { id: 'x' })], profile, new Set());

  it('picks up a field that was not stored before', () => {
    const refreshed = refreshDeckData(original, [
      card({ id: 'x', name: 'Sol Ring', color_identity: [] , cmc: 1 }),
    ]);
    expect(refreshed.cards[0]?.cmc).toBe(1);
  });

  it('keeps the choices, profile and collection fingerprint', () => {
    const refreshed = refreshDeckData(original, [card({ id: 'x', name: 'Sol Ring' })]);
    expect(refreshed.chosen).toEqual(original.chosen);
    expect(refreshed.profile).toBe(original.profile);
    expect(refreshed.owned).toBe(original.owned);
  });

  it('keeps a card the refresh did not return', () => {
    // A printing can vanish from a lookup; dropping it would corrupt the deck.
    const refreshed = refreshDeckData(original, []);
    expect(refreshed.cards).toHaveLength(1);
    expect(refreshed.cards[0]?.id).toBe('x');
  });
});

describe('resolveFromDeckData', () => {
  const resolved = [at('Sol Ring', 1), at('Swamp', 7)];
  const data = buildDeckData('deck', resolved, profile, new Set());
  const entries = resolved.map((item) => item.entry);

  it('rebuilds a resolution with no network', () => {
    const applied = resolveFromDeckData(entries, data, profile, new Set());
    expect(applied?.result.resolved).toHaveLength(2);
    expect(applied?.result.resolved[1]?.entry.quantity).toBe(7);
    expect(applied?.result.unresolved).toEqual([]);
  });

  it('refuses data written under a different profile', () => {
    // The stored printings were chosen by rules that no longer apply.
    expect(resolveFromDeckData(entries, data, { fullArt: 'avoid' }, new Set())).toBeNull();
  });

  it('refuses when the decklist has gained a card', () => {
    const grown = [...entries, entry('Brainstorm')];
    expect(resolveFromDeckData(grown, data, profile, new Set())).toBeNull();
  });

  it('refuses data chosen against a different collection', () => {
    // preferOwned makes ownership decide printings, so reusing data built
    // against someone else's shelf would silently contradict the setting.
    const owned = buildDeckData('deck', resolved, profile, new Set(['ltc|264']));
    expect(resolveFromDeckData(entries, owned, profile, new Set())).toBeNull();
    expect(resolveFromDeckData(entries, owned, profile, new Set(['ltc|264']))).not.toBeNull();
  });

  it('ignores the collection entirely when preferOwned is off', () => {
    const off: PreferenceProfile = { fullArt: 'prefer', preferOwned: false };
    const data = buildDeckData('deck', resolved, off, new Set(['a']));
    expect(data.owned).toBeNull();
    expect(resolveFromDeckData(entries, data, off, new Set(['totally', 'different']))).not.toBeNull();
  });

  it('refuses a file from a future version', () => {
    expect(resolveFromDeckData(entries, { ...data, version: 99 as never }, profile, new Set())).toBeNull();
  });

  it('still applies when the decklist only loses a card', () => {
    const shrunk = [entries[0]!];
    expect(resolveFromDeckData(shrunk, data, profile, new Set())?.result.resolved).toHaveLength(1);
  });

  it('derives warnings rather than storing them', () => {
    const lowres = [at('Blurry', 1, { image_status: 'lowres' })];
    const stored = buildDeckData('d', lowres, profile, new Set());
    const applied = resolveFromDeckData([lowres[0]!.entry], stored, profile, new Set());
    expect(applied?.result.warnings.map((w) => w.code)).toContain('low-resolution');
  });
});
