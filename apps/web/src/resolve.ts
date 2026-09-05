import {
  hasActivePreferences,
  mergeEntries,
  normalizeName,
  parseDecklist,
  resolveDeck,
  resolveDeckWithPreferences,
  type Collection,
  type Config,
  type PreferenceProfile,
  type ResolveResult,
} from '@mtgproxy/core';
import { getClient } from './platform/client.js';

/**
 * Turn decklist text into resolved printings.
 *
 * Shared by the print view and the deck browser so the two can never disagree
 * about which printing a deck uses: looking at a deck and printing it must show
 * the same cards.
 */

export interface ResolveTextOptions {
  profile: PreferenceProfile;
  collection: Collection;
  config: Config;
  ownedKeys: ReadonlySet<string>;
  onProgress?: (message: string) => void;
}

export async function resolveText(
  text: string,
  options: ResolveTextOptions,
): Promise<ResolveResult> {
  const parsed = parseDecklist(text);
  if (parsed.entries.length === 0) throw new Error('No cards found in that list.');

  const entries = mergeEntries(parsed.entries);
  const client = getClient();
  const pins = options.config.pins ?? {};
  const hasCollection = options.collection.cards.length > 0;
  const wantsPreferences =
    hasActivePreferences(options.profile, { hasCollection }) || Object.keys(pins).length > 0;

  if (!wantsPreferences) {
    options.onProgress?.('Looking up cards');
    return resolveDeck(entries, client);
  }

  const distinct = new Set(entries.map((entry) => normalizeName(entry.name))).size;
  options.onProgress?.(`Ranking printings for ${distinct} cards`);
  return resolveDeckWithPreferences(entries, client, {
    profile: options.profile,
    ownedKeys: options.ownedKeys,
    pins,
    onProgress: (done, total) => options.onProgress?.(`Ranking printings ${done}/${total}`),
  });
}

/** Every key a collection entry can be recognised by, for `preferOwned`. */
export function ownedKeysOf(collection: Collection): Set<string> {
  const keys = new Set<string>();
  for (const entry of collection.cards) {
    if (entry.scryfallId) keys.add(entry.scryfallId);
    keys.add(`${entry.set.toLowerCase()}|${entry.collectorNumber.toLowerCase()}`);
  }
  return keys;
}

/** The profile in effect, layering the saved default over the built-in baseline. */
export function activeProfile(config: Config, base: PreferenceProfile): PreferenceProfile {
  return { ...base, ...(config.defaultProfile ? config.profiles?.[config.defaultProfile] : {}) };
}

/**
 * Broad card categories for display, in the order a decklist is normally read.
 * Derived from the type line, so it needs no extra lookup.
 */
export type CardCategory =
  | 'Commander'
  | 'Creature'
  | 'Planeswalker'
  | 'Instant'
  | 'Sorcery'
  | 'Artifact'
  | 'Enchantment'
  | 'Battle'
  | 'Land'
  | 'Other';

export const CATEGORY_ORDER: readonly CardCategory[] = [
  'Commander',
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Battle',
  'Land',
  'Other',
];

export function categorise(typeLine: string, isCommander: boolean): CardCategory {
  if (isCommander) return 'Commander';
  // Order matters: an artifact creature reads as a creature, and a land that is
  // also something else is still played as a land.
  if (/\bLand\b/.test(typeLine)) return 'Land';
  if (/\bCreature\b/.test(typeLine)) return 'Creature';
  if (/\bPlaneswalker\b/.test(typeLine)) return 'Planeswalker';
  if (/\bInstant\b/.test(typeLine)) return 'Instant';
  if (/\bSorcery\b/.test(typeLine)) return 'Sorcery';
  if (/\bBattle\b/.test(typeLine)) return 'Battle';
  if (/\bArtifact\b/.test(typeLine)) return 'Artifact';
  if (/\bEnchantment\b/.test(typeLine)) return 'Enchantment';
  return 'Other';
}
