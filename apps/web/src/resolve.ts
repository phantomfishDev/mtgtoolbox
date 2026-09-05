import {
  hasActivePreferences,
  resolveFromDeckData,
  type DeckEntry,
  type ResolvedCard,
  type ScryfallCard,
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
import { bundledDeckForText, loadDeckData } from './decks.js';
import type { Overrides } from './session.js';
import { getCached, makeCacheKey, putCached } from './resolution-cache.js';

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
  /** Skip the cache and resolve again — what a retry button wants. */
  force?: boolean;
}

export async function resolveText(
  text: string,
  options: ResolveTextOptions,
): Promise<ResolveResult> {
  const key = makeCacheKey({
    text,
    profile: options.profile,
    config: options.config,
    ownedKeys: options.ownedKeys,
  });

  if (!options.force) {
    const cached = getCached(key);
    if (cached) return cached;

    // Card data shipped beside the decklist turns a minute of requests into a
    // single same-origin fetch. It is only used when the profile and the
    // collection that produced it still apply; resolveFromDeckData refuses
    // otherwise, and resolution falls through to the network.
    const stored = await storedResolution(text, options);
    if (stored) {
      putCached(key, stored);
      return stored;
    }
  }

  const result = await resolveUncached(text, options);
  putCached(key, result);
  return result;
}

async function storedResolution(
  text: string,
  options: ResolveTextOptions,
): Promise<ResolveResult | null> {
  const deck = bundledDeckForText(text);
  if (!deck) return null;

  const data = await loadDeckData(deck.id);
  if (!data) return null;

  options.onProgress?.('Reading stored card data');
  const entries = mergeEntries(parseDecklist(text).entries);
  const applied = resolveFromDeckData(entries, data, options.profile, options.ownedKeys);
  return applied?.result ?? null;
}

async function resolveUncached(
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

// ---------------------------------------------------------------------------
// Per-copy printing selection
// ---------------------------------------------------------------------------

/**
 * One tile in the card grid.
 *
 * A deck entry becomes a single slot covering all its copies, or — once split —
 * one slot per copy so each can carry its own printing.
 */
export interface DeckSlot {
  /** Normalised card name; the key into the overrides map. */
  key: string;
  card: ScryfallCard;
  entry: DeckEntry;
  /** Copies this slot stands for. Always 1 once split. */
  quantity: number;
  /** Position within the entry, or null when the slot covers every copy. */
  copyIndex: number | null;
  /** Total copies the deck runs of this card. */
  totalCopies: number;
}

/**
 * Turn resolved cards into display slots, applying any printing overrides.
 *
 * Split entries expand into one slot per copy. Slots stay in decklist order so
 * that a diff computed from them lines up index for index.
 */
export function expand(
  resolved: readonly ResolvedCard[],
  overrides: Overrides,
): DeckSlot[] {
  const slots: DeckSlot[] = [];
  for (const item of resolved) {
    const key = normalizeName(item.entry.name);
    const choice = overrides[key];
    const total = item.entry.quantity;
    const shared = choice?.all ?? item.card;

    if (choice?.copies) {
      for (let index = 0; index < total; index++) {
        slots.push({
          key,
          card: choice.copies[index] ?? shared,
          entry: item.entry,
          quantity: 1,
          copyIndex: index,
          totalCopies: total,
        });
      }
    } else {
      slots.push({ key, card: shared, entry: item.entry, quantity: total, copyIndex: null, totalCopies: total });
    }
  }
  return slots;
}

/** Slots as resolved cards, 1:1 and in the same order, for diffing and printing. */
export function slotsToCards(slots: readonly DeckSlot[]): ResolvedCard[] {
  return slots.map((slot) => ({
    entry: { ...slot.entry, quantity: slot.quantity },
    card: slot.card,
    via: 'name' as const,
  }));
}

/**
 * Pick `count` printings that genuinely look different.
 *
 * Scryfall gives several printings per artwork — the same picture in a
 * different frame or set — so choosing purely by score would hand back near
 * duplicates. One printing per `illustration_id` is taken first, best-scoring
 * first, and only once the distinct artworks run out does it repeat.
 */
export function distinctArtworks(
  ranked: readonly ScryfallCard[],
  count: number,
): { chosen: ScryfallCard[]; distinct: number } {
  const seen = new Set<string>();
  const unique: ScryfallCard[] = [];
  for (const card of ranked) {
    const art = card.illustration_id ?? card.id;
    if (seen.has(art)) continue;
    seen.add(art);
    unique.push(card);
    if (unique.length === count) break;
  }
  if (unique.length === 0) return { chosen: [], distinct: 0 };
  // Fewer artworks than copies: cycle rather than leaving copies unassigned.
  return {
    chosen: Array.from({ length: count }, (_, index) => unique[index % unique.length]!),
    distinct: unique.length,
  };
}
