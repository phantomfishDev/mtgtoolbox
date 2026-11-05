import {
  hasActivePreferences,
  resolveFromDeckDataWithLookups,
  type DeckEntry,
  type ResolvedCard,
  type ScryfallCard,
  mergeEntries,
  normalizeName,
  parseDecklist,
  selectForTokenMode,
  type TokenMode,
  resolveDeck,
  resolveDeckWithPreferences,
  type Config,
  type PreferenceProfile,
  type ResolveResult,
} from '@mtgtoolbox/core';
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
  /** What to do with the list's `Tokens` section. Default: `exclude`. */
  tokenMode?: TokenMode;
  config: Config;
  onProgress?: (message: string) => void;
  /** Skip the cache and resolve again — what a retry button wants. */
  force?: boolean;
  /**
   * The bundled deck this text came from, when the caller knows.
   *
   * Pins are applied by rewriting the list, so after the first one the text no
   * longer matches any file on disk and recognising the deck by its contents
   * fails. Naming it keeps its stored card data in play for the whole session.
   */
  deckId?: string;
}

export async function resolveText(
  text: string,
  options: ResolveTextOptions,
): Promise<ResolveResult> {
  const key = makeCacheKey({
    text,
    profile: options.profile,
    config: options.config,
    // The same list resolves to different cards per mode: the deck page's
    // cards-only result must not be served to a print that wants tokens.
    tokenMode: options.tokenMode,
  });

  if (!options.force) {
    const cached = getCached(key);
    if (cached) return cached;

    // Card data shipped beside the decklist turns a minute of requests into a
    // single same-origin fetch. It is only used when the profile and the
    // profile that produced it still applies; the stored path refuses
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
  const id = options.deckId ?? bundledDeckForText(text)?.id;
  if (!id) return null;

  const data = await loadDeckData(id);
  if (!data) return null;

  options.onProgress?.('Reading stored card data');
  const entries = mergeEntries(
    selectForTokenMode(parseDecklist(text).entries, options.tokenMode ?? 'exclude'),
  );
  // Printings the file does not hold — pins chosen since it was written — are
  // fetched by set and number rather than sending the deck back through
  // ranking, which would re-fetch every printing of every other card too.
  const applied = await resolveFromDeckDataWithLookups(entries, data, getClient(), options.profile);
  return applied?.result ?? null;
}

async function resolveUncached(
  text: string,
  options: ResolveTextOptions,
): Promise<ResolveResult> {
  const parsed = parseDecklist(text);
  if (parsed.entries.length === 0) throw new Error('No cards found in that list.');

  const entries = mergeEntries(selectForTokenMode(parsed.entries, options.tokenMode ?? 'exclude'));
  if (entries.length === 0) {
    throw new Error(
      options.tokenMode === 'only'
        ? 'That list has no Tokens section, so there is nothing to print.'
        : 'No cards found in that list.',
    );
  }
  const client = getClient();
  const pins = options.config.pins ?? {};
  const wantsPreferences =
    hasActivePreferences(options.profile) || Object.keys(pins).length > 0;

  if (!wantsPreferences) {
    options.onProgress?.('Looking up cards');
    return resolveDeck(entries, client);
  }

  const distinct = new Set(entries.map((entry) => normalizeName(entry.name))).size;
  options.onProgress?.(`Ranking printings for ${distinct} cards`);
  return resolveDeckWithPreferences(entries, client, {
    profile: options.profile,
    pins,
    onProgress: (done, total) => options.onProgress?.(`Ranking printings ${done}/${total}`),
  });
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
