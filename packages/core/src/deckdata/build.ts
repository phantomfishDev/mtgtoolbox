import type { DeckEntry } from '../decklist/parse.js';
import type { ResolveResult, ResolvedCard } from '../scryfall/resolve.js';
import { isDoubleFaced, type ScryfallCard } from '../scryfall/types.js';
import { normalizeName } from '../collection/types.js';
import type { PreferenceProfile } from '../printing/profile.js';
import { DECK_DATA_VERSION, STORED_CARD_FIELDS, type DeckData } from './types.js';

/**
 * Building deck data from a resolution, and reading it back without a network.
 */

/**
 * A fingerprint of the rules that chose these printings.
 *
 * Stored data is only valid for the profile that produced it, so a changed
 * preference has to be detectable. Keys are sorted so that two equal profiles
 * written in a different order still match.
 */
export function profileFingerprint(profile: PreferenceProfile): string {
  return hashString(canonicalJson(profile));
}

/**
 * JSON with object keys sorted at every level.
 *
 * `JSON.stringify`'s replacer-array only sorts the top level and, worse,
 * filters every nested object down to those same keys — so a difference inside
 * `basics` could vanish from the fingerprint and two unlike profiles would
 * share stored data.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

function trimImages(uris: ScryfallCard['image_uris']) {
  if (!uris) return undefined;
  // Only the sizes that get printed or displayed; image bytes are never stored.
  const { png, large, normal } = uris;
  return png || large || normal ? { png, large, normal } : undefined;
}

/** Reduce a card to the fields this project reads. */
export function trimCard(card: ScryfallCard): ScryfallCard {
  const out: Record<string, unknown> = {};
  for (const field of STORED_CARD_FIELDS) {
    const value = card[field];
    if (value !== undefined) out[field] = value;
  }
  const images = trimImages(card.image_uris);
  if (images) out['image_uris'] = images;
  if (card.card_faces) {
    out['card_faces'] = card.card_faces.map((face) => ({
      name: face.name,
      ...(face.type_line !== undefined ? { type_line: face.type_line } : {}),
      ...(face.mana_cost !== undefined ? { mana_cost: face.mana_cost } : {}),
      ...(face.oracle_text !== undefined ? { oracle_text: face.oracle_text } : {}),
      ...(face.cmc !== undefined ? { cmc: face.cmc } : {}),
      ...(trimImages(face.image_uris) ? { image_uris: trimImages(face.image_uris) } : {}),
    }));
  }
  return out as unknown as ScryfallCard;
}

/**
 * Fingerprint of the printings a collection holds.
 *
 * Only meaningful when `preferOwned` is on; otherwise ownership cannot change
 * which printing wins and the collection is deliberately left out, so that
 * adding a card does not invalidate every stored deck.
 */
export function ownedFingerprint(
  profile: PreferenceProfile,
  ownedKeys: ReadonlySet<string> | undefined,
): string | null {
  if (!profile.preferOwned) return null;
  return hashString(canonicalJson([...(ownedKeys ?? [])].sort()));
}

function hashString(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

export function buildDeckData(
  deck: string,
  resolved: readonly ResolvedCard[],
  profile: PreferenceProfile,
  ownedKeys?: ReadonlySet<string>,
): DeckData {
  const cards = new Map<string, ScryfallCard>();
  const chosen: Record<string, string> = {};

  for (const item of resolved) {
    cards.set(item.card.id, trimCard(item.card));
    chosen[normalizeName(item.entry.name)] = item.card.id;
  }

  return {
    version: DECK_DATA_VERSION,
    deck,
    generatedAt: new Date().toISOString(),
    profile: profileFingerprint(profile),
    owned: ownedFingerprint(profile, ownedKeys),
    // Sorted so regenerating an unchanged deck produces no diff.
    cards: [...cards.values()].sort((a, b) => a.id.localeCompare(b.id)),
    chosen: Object.fromEntries(Object.entries(chosen).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export interface ApplyResult {
  result: ResolveResult;
  /** Entries the stored data did not cover; empty when it fully applied. */
  missing: DeckEntry[];
}

/**
 * Rebuild a resolution from stored data, with no network.
 *
 * Returns null when the data cannot be trusted for these inputs — a different
 * preference profile, or a decklist that has gained cards since the file was
 * written — so the caller falls back to resolving properly rather than showing
 * something subtly wrong.
 */
export function resolveFromDeckData(
  entries: readonly DeckEntry[],
  data: DeckData,
  profile: PreferenceProfile,
  ownedKeys?: ReadonlySet<string>,
): ApplyResult | null {
  if (data.version !== DECK_DATA_VERSION) return null;
  if (data.profile !== profileFingerprint(profile)) return null;
  // With preferOwned on, what you own changes which printing wins, so data
  // chosen against a different collection would quietly contradict the setting.
  if (data.owned !== ownedFingerprint(profile, ownedKeys)) return null;

  const byId = new Map(data.cards.map((card) => [card.id, card]));
  const resolved: ResolvedCard[] = [];
  const missing: DeckEntry[] = [];

  for (const entry of entries) {
    const id = data.chosen[normalizeName(entry.name)];
    const card = id ? byId.get(id) : undefined;
    if (!card) {
      missing.push(entry);
      continue;
    }
    resolved.push({ entry, card, via: 'name' });
  }

  if (missing.length > 0) return null;

  // Warnings are derived rather than stored: they follow from the cards, and
  // storing them would let the two drift apart.
  const warnings = resolved.flatMap((item) => {
    const list = [];
    if (isDoubleFaced(item.card)) {
      list.push({
        entry: item.entry,
        card: item.card,
        code: 'double-faced' as const,
        message: `${item.card.name} is double-faced; only the front face will be printed`,
      });
    }
    if (item.card.image_status !== 'highres_scan') {
      list.push({
        entry: item.entry,
        card: item.card,
        code: 'low-resolution' as const,
        message: `${item.card.name} (${item.card.set.toUpperCase()}) has a ${item.card.image_status} image and will print poorly`,
      });
    }
    return list;
  });

  return { result: { resolved, unresolved: [], warnings }, missing: [] };
}
