import { describe, expect, it } from 'vitest';
import {
  buildDeckData,
  refreshDeckData,
  profileFingerprint,
  resolveFromDeckData,
  resolveFromDeckDataWithLookups,
  trimCard,
} from '../src/deckdata/build.js';
import { parseDeckData, DECK_DATA_VERSION } from '../src/deckdata/types.js';
import type { ResolvedCard } from '../src/scryfall/resolve.js';
import type { CardIdentifier, CollectionResponse } from '../src/scryfall/types.js';
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

const profile: PreferenceProfile = { fullArt: 'prefer' };

describe('profileFingerprint', () => {
  it('is stable for the same profile', () => {
    expect(profileFingerprint(profile)).toBe(profileFingerprint({ ...profile }));
  });

  it('ignores key order', () => {
    expect(profileFingerprint({ fullArt: 'prefer', lang: 'en' })).toBe(
      profileFingerprint({ lang: 'en', fullArt: 'prefer' }),
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

describe('refreshDeckData', () => {
  const original = buildDeckData('deck', [at('Sol Ring', 1, { id: 'x' })], profile, new Set());

  it('picks up a field that was not stored before', () => {
    const refreshed = refreshDeckData(original, [
      card({ id: 'x', name: 'Sol Ring', color_identity: [] , cmc: 1 }),
    ]);
    expect(refreshed.cards[0]?.cmc).toBe(1);
  });

  it('keeps the choices and the profile fingerprint', () => {
    const refreshed = refreshDeckData(original, [card({ id: 'x', name: 'Sol Ring' })]);
    expect(refreshed.chosen).toEqual(original.chosen);
    expect(refreshed.profile).toBe(original.profile);
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
  const data = buildDeckData('deck', resolved, profile);
  const entries = resolved.map((item) => item.entry);

  it('rebuilds a resolution with no network', () => {
    const applied = resolveFromDeckData(entries, data, profile);
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
    expect(resolveFromDeckData(grown, data, profile)).toBeNull();
  });

  it('refuses stored data that contradicts a pinned printing', () => {
    // Editing `(SET) NUM` in a decklist has to take effect even though a data
    // file sits beside it; matching on the name alone would ignore the edit.
    const pinned = [{ ...entries[0]!, set: 'ltc', collectorNumber: '284' }, entries[1]!];
    expect(resolveFromDeckData(pinned, data, profile)).toBeNull();
  });

  it('accepts stored data that is the pinned printing', () => {
    const chosen = [at('Sol Ring', 1, { set: 'ltc', collector_number: '284' })];
    const stored = buildDeckData('deck', chosen, profile);
    const pinned = [{ ...chosen[0]!.entry, set: 'ltc', collectorNumber: '284' }];
    const applied = resolveFromDeckData(pinned, stored, profile);
    expect(applied?.result.resolved[0]?.card.collector_number).toBe('284');
    expect(applied?.result.resolved[0]?.via).toBe('printing');
  });

  it('matches a pinned set code regardless of case', () => {
    const chosen = [at('Sol Ring', 1, { set: 'ltc', collector_number: '284' })];
    const stored = buildDeckData('deck', chosen, profile);
    const pinned = [{ ...chosen[0]!.entry, set: 'LTC', collectorNumber: '284' }];
    expect(resolveFromDeckData(pinned, stored, profile)).not.toBeNull();
  });

  it('refuses a file from a future version', () => {
    expect(resolveFromDeckData(entries, { ...data, version: 99 as never }, profile)).toBeNull();
  });

  it('still applies when the decklist only loses a card', () => {
    const shrunk = [entries[0]!];
    expect(resolveFromDeckData(shrunk, data, profile)?.result.resolved).toHaveLength(1);
  });

  it('derives warnings rather than storing them', () => {
    const lowres = [at('Blurry', 1, { image_status: 'lowres' })];
    const stored = buildDeckData('d', lowres, profile);
    const applied = resolveFromDeckData([lowres[0]!.entry], stored, profile, new Set());
    expect(applied?.result.warnings.map((w) => w.code)).toContain('low-resolution');
  });
});

describe('a card and a token of the same name', () => {
  // beorn-bears runs the Mutavault land and the Mutavault token;
  // kwain-hare-apparent runs the Intrepid Rabbit creature and its token.
  // Keyed by bare name these overwrite each other, and the stored data ends up
  // pointing a token at a land.
  const land = at('Mutavault', 1, { set: 'eos', collector_number: '28', type_line: 'Land' });
  const token: ResolvedCard = {
    entry: { quantity: 1, name: 'Mutavault', line: 2, raw: '1 Mutavault', section: 'tokens' },
    card: card({
      id: 'tok-mutavault',
      name: 'Mutavault',
      set: 'tecl',
      collector_number: '11',
      layout: 'token',
    }),
    via: 'name',
  };

  it('keeps both printings, under separate keys', () => {
    const data = buildDeckData('beorn-bears', [land, token], profile);
    expect(Object.keys(data.chosen).sort()).toEqual(['mutavault', 'token:mutavault']);
    expect(data.cards).toHaveLength(2);
  });

  it('gives each entry back its own printing, not the other one', () => {
    const data = buildDeckData('beorn-bears', [land, token], profile);
    const applied = resolveFromDeckData([land.entry, token.entry], data, profile);
    expect(applied).not.toBeNull();
    const [first, second] = applied!.result.resolved;
    expect(first?.card.type_line).toBe('Land');
    expect(second?.card.layout).toBe('token');
  });

  it('re-resolves rather than guessing when the data predates token keys', () => {
    const data = buildDeckData('beorn-bears', [land], profile);
    expect(resolveFromDeckData([land.entry, token.entry], data, profile)).toBeNull();
  });
});

describe('two tokens of the same name', () => {
  // beorn-bears lists a 2/2 Bear and a 4/4 Bear; rats two different 1/1 Rats;
  // prismari-artistry four different Elementals. Keyed by name alone they
  // collapse into one stored choice and the rest inherit the wrong art.
  const bear = (set: string, number: string, id: string): ResolvedCard => ({
    entry: {
      quantity: 1,
      name: 'Bear',
      set,
      collectorNumber: number,
      line: 1,
      raw: `1 Bear (${set.toUpperCase()}) ${number}`,
      section: 'tokens',
    },
    card: card({ id, name: 'Bear', set, collector_number: number, layout: 'token' }),
    via: 'printing',
  });

  const small = bear('thob', '7', 'bear-2-2');
  const big = bear('ttla', '12', 'bear-4-4');

  it('stores a choice for each, keyed by its pin', () => {
    const data = buildDeckData('beorn-bears', [small, big], profile);
    expect(Object.keys(data.chosen).sort()).toEqual(['token:bear|thob|7', 'token:bear|ttla|12']);
    expect(data.cards).toHaveLength(2);
  });

  it('reads each row back at its own art, so stored data is still usable', () => {
    const data = buildDeckData('beorn-bears', [small, big], profile);
    const applied = resolveFromDeckData([small.entry, big.entry], data, profile);
    expect(applied).not.toBeNull();
    expect(applied!.result.resolved.map((item) => item.card.id)).toEqual(['bear-2-2', 'bear-4-4']);
  });
});

describe('resolveFromDeckDataWithLookups', () => {
  const resolved = [at('Sol Ring', 1), at('Swamp', 7)];
  const data = buildDeckData('deck', resolved, profile);
  const entries = resolved.map((item) => item.entry);

  /** A stand-in for the client, recording what it was actually asked for. */
  function lookup(cards: readonly ReturnType<typeof card>[]) {
    const asked: CardIdentifier[][] = [];
    return {
      asked,
      async collection(identifiers: readonly CardIdentifier[]): Promise<CollectionResponse> {
        asked.push([...identifiers]);
        return { data: [...cards], not_found: [] };
      },
    };
  }

  it('asks for nothing when the stored data covers the list', async () => {
    const client = lookup([]);
    const applied = await resolveFromDeckDataWithLookups(entries, data, client, profile);
    expect(applied?.result.resolved).toHaveLength(2);
    expect(client.asked).toEqual([]);
  });

  it('fetches only the printing a pin named, not every printing of every card', async () => {
    // This is the whole point: pinning one card used to invalidate the file and
    // send a hundred-card deck back through ranking, a request per card.
    const pin = card({ name: 'Sol Ring', set: 'ltc', collector_number: '284' });
    const client = lookup([pin]);
    const pinned = [{ ...entries[0]!, set: 'ltc', collectorNumber: '284' }, entries[1]!];

    const applied = await resolveFromDeckDataWithLookups(pinned, data, client, profile);

    expect(client.asked).toEqual([[{ set: 'ltc', collector_number: '284' }]]);
    expect(applied?.result.resolved[0]?.card.collector_number).toBe('284');
    expect(applied?.result.resolved[0]?.via).toBe('printing');
    // The rest of the deck keeps the printings the file already held, in order.
    expect(applied?.result.resolved[1]?.entry.name).toBe('Swamp');
    expect(applied?.result.resolved[1]?.entry.quantity).toBe(7);
  });

  it('batches every gap into one request', async () => {
    const client = lookup([
      card({ name: 'Sol Ring', set: 'ltc', collector_number: '284' }),
      card({ name: 'Swamp', set: 'ltc', collector_number: '400' }),
    ]);
    const pinned = [
      { ...entries[0]!, set: 'ltc', collectorNumber: '284' },
      { ...entries[1]!, set: 'ltc', collectorNumber: '400' },
    ];
    await resolveFromDeckDataWithLookups(pinned, data, client, profile);
    expect(client.asked).toHaveLength(1);
    expect(client.asked[0]).toHaveLength(2);
  });

  it('hands back a gap that names no printing, since that one has to be ranked', async () => {
    const client = lookup([]);
    const grown = [...entries, entry('Brainstorm')];
    expect(
      await resolveFromDeckDataWithLookups(grown, data, client, profile),
    ).toBeNull();
    expect(client.asked).toEqual([]);
  });

  it('hands back a printing that turns out to be a different card', async () => {
    // A hand-edited `(SET) NUM` can point anywhere. Resolving to whatever sits
    // at that number would put the wrong card in the deck without saying so.
    const client = lookup([card({ name: 'Black Lotus', set: 'ltc', collector_number: '284' })]);
    const pinned = [{ ...entries[0]!, set: 'ltc', collectorNumber: '284' }, entries[1]!];
    expect(
      await resolveFromDeckDataWithLookups(pinned, data, client, profile),
    ).toBeNull();
  });

  it('accepts a double-faced card listed by its front face alone', async () => {
    const front = card({
      name: 'Beorn, Reluctant Host // Till and Tend',
      set: 'hob',
      collector_number: '118',
      card_faces: [{ name: 'Beorn, Reluctant Host' }, { name: 'Till and Tend' }] as never,
    });
    const client = lookup([front]);
    const pinned = [
      { ...entry('Beorn, Reluctant Host'), set: 'hob', collectorNumber: '118' },
      entries[1]!,
    ];
    const stored = buildDeckData('deck', [at('Swamp', 7)], profile);
    const applied = await resolveFromDeckDataWithLookups(
      pinned,
      stored,
      client,
      profile,
    );
    expect(applied?.result.resolved[0]?.card.set).toBe('hob');
  });

  it('hands back a pin that names a printing which does not exist', async () => {
    // The ranking path reports this properly, as a missed pin.
    const client = lookup([]);
    const pinned = [{ ...entries[0]!, set: 'nope', collectorNumber: '1' }, entries[1]!];
    expect(
      await resolveFromDeckDataWithLookups(pinned, data, client, profile),
    ).toBeNull();
  });

  it('still refuses data written under a different profile', async () => {
    const client = lookup([]);
    expect(
      await resolveFromDeckDataWithLookups(entries, data, client, { fullArt: 'avoid' }),
    ).toBeNull();
    expect(client.asked).toEqual([]);
  });

  it('derives warnings for a fetched printing too', async () => {
    const pin = card({
      name: 'Sol Ring',
      set: 'ltc',
      collector_number: '284',
      image_status: 'lowres',
    });
    const client = lookup([pin]);
    const pinned = [{ ...entries[0]!, set: 'ltc', collectorNumber: '284' }, entries[1]!];
    const applied = await resolveFromDeckDataWithLookups(pinned, data, client, profile);
    expect(applied?.result.warnings.map((w) => w.code)).toContain('low-resolution');
  });
});
