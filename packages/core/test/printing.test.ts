import { describe, expect, it } from 'vitest';
import {
  comparePrintings,
  isUniversesBeyond,
  scorePrinting,
  selectPrinting,
} from '../src/printing/score.js';
import {
  DEFAULT_PROFILE,
  mergeProfiles,
  parseConfig,
  profileFor,
  type PreferenceProfile,
} from '../src/printing/profile.js';
import { hasActivePreferences, resolveDeckWithPreferences } from '../src/printing/resolve.js';
import { card } from './helpers.js';

const chosenSet = (profile: PreferenceProfile, cards: ReturnType<typeof card>[]) =>
  selectPrinting(cards, profile)?.chosen.set;

describe('scorePrinting', () => {
  it('ranks preferred sets in the order given', () => {
    const cards = [card({ set: 'aaa' }), card({ set: 'bbb' }), card({ set: 'ccc' })];
    const profile = { preferSets: ['bbb', 'ccc'] };
    expect(chosenSet(profile, cards)).toBe('bbb');
  });

  it('penalises avoided sets', () => {
    const cards = [card({ set: 'aaa' }), card({ set: 'bbb' })];
    expect(chosenSet({ avoidSets: ['aaa'] }, cards)).toBe('bbb');
  });

  it('treats full art and borderless as independent traits', () => {
    const fullArt = card({ set: 'fa', full_art: true });
    const borderless = card({ set: 'bl', border_color: 'borderless' });
    expect(chosenSet({ fullArt: 'prefer' }, [borderless, fullArt])).toBe('fa');
    expect(chosenSet({ borderless: 'prefer' }, [fullArt, borderless])).toBe('bl');
  });

  it('disqualifies printings that fail a require rule', () => {
    const plain = card({ set: 'aaa' });
    const result = scorePrinting(plain, { fullArt: 'require' });
    expect(result.disqualified).toMatch(/full art/);
  });

  it('rejects low-resolution scans when requireHighres is set', () => {
    const lowres = card({ image_status: 'lowres' });
    expect(scorePrinting(lowres, { requireHighres: true }).disqualified).toMatch(/lowres/);
  });

  it('detects Universes Beyond from promo_types', () => {
    expect(isUniversesBeyond(card({ promo_types: ['surgefoil', 'universesbeyond'] }))).toBe(true);
    expect(isUniversesBeyond(card({ promo_types: ['surgefoil'] }))).toBe(false);
    expect(isUniversesBeyond(card())).toBe(false);
  });

  it('avoids Universes Beyond printings when asked', () => {
    const ub = card({ set: 'msc', promo_types: ['universesbeyond'] });
    const normal = card({ set: 'cmm' });
    expect(chosenSet({ universesBeyond: 'avoid' }, [ub, normal])).toBe('cmm');
  });

  it('lets an explicit avoid outrank every bonus', () => {
    // Asking for no Universes Beyond printings must win even when the UB
    // printing scores better on everything else.
    const fancyUb = card({
      set: 'msc',
      id: 'fancy-ub',
      promo_types: ['universesbeyond'],
      full_art: true,
    });
    const plain = card({ set: 'cmm', id: 'plain' });
    const result = selectPrinting([fancyUb, plain], {
      universesBeyond: 'avoid',
      fullArt: 'prefer',
    });
    expect(result?.chosen.set).toBe('cmm');
  });

  it('handles a null frame_effects without crashing', () => {
    const noEffects = card({ frame_effects: undefined });
    expect(() => scorePrinting(noEffects, { frameEffects: ['showcase'] })).not.toThrow();
  });

  it('rewards a matching frame effect', () => {
    const showcase = card({ set: 'sc', frame_effects: ['showcase'] });
    const plain = card({ set: 'pl' });
    expect(chosenSet({ frameEffects: ['showcase'] }, [plain, showcase])).toBe('sc');
  });
});

describe('selectPrinting', () => {
  it('relaxes hard rules rather than returning nothing', () => {
    const only = card({ set: 'aaa', full_art: false });
    const result = selectPrinting([only], { fullArt: 'require' });
    expect(result?.relaxed).toBe(true);
    expect(result?.chosen.set).toBe('aaa');
  });

  it('does not relax when something qualifies', () => {
    const good = card({ set: 'fa', full_art: true });
    const bad = card({ set: 'no', full_art: false });
    const result = selectPrinting([bad, good], { fullArt: 'require' });
    expect(result?.relaxed).toBe(false);
    expect(result?.chosen.set).toBe('fa');
  });

  it('returns null for no candidates', () => {
    expect(selectPrinting([], {})).toBeNull();
  });

  it('breaks ties by release date, then collector number', () => {
    const older = card({ set: 'a', released_at: '2020-01-01', collector_number: '1' });
    const newer = card({ set: 'b', released_at: '2024-01-01', collector_number: '5' });
    expect(chosenSet({}, [older, newer])).toBe('b');

    const sameDay = [
      card({ set: 'x', released_at: '2024-01-01', collector_number: '10' }),
      card({ set: 'x', released_at: '2024-01-01', collector_number: '2' }),
    ];
    expect(selectPrinting(sameDay, {})?.chosen.collector_number).toBe('2');
  });

  it('is deterministic across repeated runs', () => {
    const cards = [card({ set: 'a' }), card({ set: 'b' }), card({ set: 'c' })];
    const runs = new Set(
      Array.from({ length: 5 }, () => selectPrinting([...cards], DEFAULT_PROFILE)?.chosen.id),
    );
    expect(runs.size).toBe(1);
  });

  it('orders by score before any tie-break', () => {
    const a = scorePrinting(card({ set: 'a' }), { preferSets: ['a'] });
    const b = scorePrinting(card({ set: 'b', released_at: '2099-01-01' }), { preferSets: ['a'] });
    expect(comparePrintings(a, b)).toBeLessThan(0);
  });
});

describe('profiles', () => {
  it('layers profiles with later values winning', () => {
    const merged = mergeProfiles({ fullArt: 'prefer', lang: 'en' }, { fullArt: 'avoid' });
    expect(merged).toMatchObject({ fullArt: 'avoid', lang: 'en' });
  });

  it('layers the basics sub-policy on top of the main profile', () => {
    const profile: PreferenceProfile = {
      requireHighres: true,
      fullArt: 'ignore',
      basics: { fullArt: 'require', preferSets: ['unf'] },
    };
    const forBasic = profileFor(profile, true);
    expect(forBasic.fullArt).toBe('require');
    // Shared rules survive rather than being replaced.
    expect(forBasic.requireHighres).toBe(true);
    expect(profileFor(profile, false).fullArt).toBe('ignore');
  });

  it('rejects an invalid config with a helpful message', () => {
    expect(() => parseConfig({ profiles: { bad: { fullArt: 'sometimes' } } })).toThrow(/invalid/);
  });

  it('accepts a valid config', () => {
    const config = parseConfig({
      defaultProfile: 'retro',
      profiles: { retro: { retroFrame: 'prefer', preferSets: ['CMM'] } },
      pins: { 'sol ring': { set: 'ltc', collectorNumber: '264' } },
    });
    expect(config.profiles?.retro?.preferSets).toEqual(['cmm']);
  });
});

describe('hasActivePreferences', () => {
  it('is false for a profile carrying only safety rules', () => {
    // Rules that merely exclude unprintable cards cannot change which printing
    // wins, so they must not force the per-card resolution path.
    expect(
      hasActivePreferences({
        requireHighres: true,
        lang: 'en',
        textless: 'avoid',
        avoidSetTypes: ['memorabilia'],
      }),
    ).toBe(false);
  });

  it('is true for the shipped default, which is deliberately opinionated', () => {
    // The default expresses real taste (full art, borderless, no Universes
    // Beyond), so every deck resolves through the slower path that fetches all
    // printings. That cost is the price of the default having opinions.
    expect(hasActivePreferences(DEFAULT_PROFILE)).toBe(true);
  });

  it('is true for any real preference', () => {
    expect(hasActivePreferences({ preferSets: ['cmm'] })).toBe(true);
    expect(hasActivePreferences({ fullArt: 'prefer' })).toBe(true);
  });

  it('ignores rules explicitly set to ignore', () => {
    expect(hasActivePreferences({ fullArt: 'ignore', borderless: 'ignore' })).toBe(false);
  });
});

describe('a card and a token of the same name', () => {
  // The printing cache used to be keyed by bare name, so these two entries
  // shared one fetch and whichever came first decided whether tokens were
  // looked up at all. The token then inherited the card's printings and its
  // pin missed, so a Mutavault token resolved to the Mutavault land.
  const landEntry = { quantity: 1, name: 'Mutavault', line: 1, raw: '1 Mutavault' };
  const tokenEntry = {
    quantity: 1,
    name: 'Mutavault',
    set: 'tecl',
    collectorNumber: '11',
    line: 2,
    raw: '1 Mutavault (TECL) 11',
    section: 'tokens' as const,
  };

  const realCard = card({ id: 'land', name: 'Mutavault', set: 'eos', collector_number: '28', type_line: 'Land' });
  const tokenCard = card({ id: 'tok', name: 'Mutavault', set: 'tecl', collector_number: '11', layout: 'token' });

  function clientFor(seen: string[]) {
    return {
      async prints(name: string, options?: { extras?: boolean }) {
        seen.push(options?.extras ? `${name}+extras` : name);
        return options?.extras ? [tokenCard, realCard] : [realCard];
      },
      async named() {
        return null;
      },
    } as unknown as Parameters<typeof resolveDeckWithPreferences>[1];
  }

  it('fetches each separately and gives each its own printing', async () => {
    const seen: string[] = [];
    const result = await resolveDeckWithPreferences([landEntry, tokenEntry], clientFor(seen), {
      profile: {},
    });

    expect(seen).toEqual(['Mutavault', 'Mutavault+extras']);
    expect(result.unresolved).toHaveLength(0);
    expect(result.resolved.map((item) => item.card.id)).toEqual(['land', 'tok']);
    // No pin-missed warning: the token's pin was found among token printings.
    expect(result.warnings.filter((w) => w.code === 'pin-missed')).toHaveLength(0);
  });
});
