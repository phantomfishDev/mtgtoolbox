import { choiceKey, fetchKey, type DeckEntry } from '../decklist/parse.js';
import type { ResolveResult, ResolvedCard, ResolveWarning } from '../scryfall/resolve.js';
import {
  isDoubleFaced,
  type CardIdentifier,
  type CollectionResponse,
  type ScryfallCard,
} from '../scryfall/types.js';
import { normalizeName } from '../cards/identity.js';
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

function hashString(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

/**
 * Key for the stored entry -> printing map.
 *
 * `choiceKey` rather than a bare name, so two Bear tokens or nine arts of one
 * card each keep their own stored choice. Data written before these keys
 * existed does not have them, so those entries miss and the caller
 * re-resolves — which is the right fallback.
 */
export function chosenKey(
  entry: Pick<DeckEntry, 'name' | 'section' | 'set' | 'collectorNumber'>,
): string {
  return choiceKey(entry);
}

export function buildDeckData(
  deck: string,
  resolved: readonly ResolvedCard[],
  profile: PreferenceProfile,
): DeckData {
  const cards = new Map<string, ScryfallCard>();
  const chosen: Record<string, string> = {};

  for (const item of resolved) {
    cards.set(item.card.id, trimCard(item.card));
    chosen[chosenKey(item.entry)] = item.card.id;
  }

  return {
    version: DECK_DATA_VERSION,
    deck,
    generatedAt: new Date().toISOString(),
    profile: profileFingerprint(profile),
    // Sorted so regenerating an unchanged deck produces no diff.
    cards: [...cards.values()].sort((a, b) => a.id.localeCompare(b.id)),
    chosen: Object.fromEntries(Object.entries(chosen).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Replace the stored cards with freshly fetched ones, keeping the choices.
 *
 * When this project starts reading a card field it did not store before, every
 * existing file is missing it. Re-running preference resolution to fill that in
 * would cost one request per distinct card for no benefit — the printings were
 * already chosen. Looking those exact printings up by id costs one request per
 * seventy-five cards and changes nothing else about the file.
 */
export function refreshDeckData(data: DeckData, fresh: readonly ScryfallCard[]): DeckData {
  const byId = new Map(fresh.map((card) => [card.id, trimCard(card)]));
  return {
    ...data,
    generatedAt: new Date().toISOString(),
    cards: data.cards
      .map((card) => byId.get(card.id) ?? card)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Does this card answer to the name on the line? A double-faced card may be listed by its front face. */
function sameName(card: ScryfallCard, entry: DeckEntry): boolean {
  const wanted = normalizeName(entry.name);
  return (
    normalizeName(card.name) === wanted ||
    normalizeName(card.card_faces?.[0]?.name ?? '') === wanted
  );
}

/** Is the stored card the printing this line pinned? */
function sameFacePrinting(card: ScryfallCard, entry: DeckEntry): boolean {
  if (card.set.toLowerCase() !== entry.set?.toLowerCase()) return false;
  if (!entry.collectorNumber) return true;
  return card.collector_number.toLowerCase() === entry.collectorNumber.toLowerCase();
}

export interface ApplyResult {
  result: ResolveResult;
  /** Entries the stored data did not cover; empty when it fully applied. */
  missing: DeckEntry[];
}

/** One decklist entry paired with its stored printing, or null where there is none. */
interface Slot {
  entry: DeckEntry;
  card: ScryfallCard | null;
}

/**
 * Pair every entry with the printing stored for it, in decklist order.
 *
 * Returns null when the file cannot be trusted for these inputs at all — a
 * different version or profile — as opposed to an individual entry it simply
 * does not hold, which comes back as a null card.
 */
function applyStored(
  entries: readonly DeckEntry[],
  data: DeckData,
  profile: PreferenceProfile,
): Slot[] | null {
  if (data.version !== DECK_DATA_VERSION) return null;
  if (data.profile !== profileFingerprint(profile)) return null;

  const byId = new Map(data.cards.map((card) => [card.id, card]));

  return entries.map((entry) => {
    // The entry's own key first. Falling back to the unpinned key lets data
    // written before a pin was added still apply: adding a pin that names the
    // printing already chosen should not force a re-resolve, and the
    // `sameFacePrinting` check below rejects it if it names a different one.
    const id = data.chosen[chosenKey(entry)] ?? data.chosen[fetchKey(entry)];
    const card = id ? byId.get(id) : undefined;
    if (!card) return { entry, card: null };
    // A line that names a printing outranks whatever was stored. Without this
    // check, editing a pin in the decklist would appear to do nothing for as
    // long as a data file sat beside it, because the name still matched.
    if (entry.set && !sameFacePrinting(card, entry)) return { entry, card: null };
    return { entry, card };
  });
}

/** Warnings are derived rather than stored: storing them would let the two drift apart. */
function storedWarnings(resolved: readonly ResolvedCard[]): ResolveWarning[] {
  return resolved.flatMap((item) => {
    const list: ResolveWarning[] = [];
    if (isDoubleFaced(item.card)) {
      list.push({
        entry: item.entry,
        card: item.card,
        code: 'double-faced',
        message: `${item.card.name} is double-faced; only the front face will be printed`,
      });
    }
    if (item.card.image_status !== 'highres_scan') {
      list.push({
        entry: item.entry,
        card: item.card,
        code: 'low-resolution',
        message: `${item.card.name} (${item.card.set.toUpperCase()}) has a ${item.card.image_status} image and will print poorly`,
      });
    }
    return list;
  });
}

function finish(slots: readonly Slot[]): ApplyResult {
  const resolved = slots.map((slot) => ({
    entry: slot.entry,
    card: slot.card!,
    via: slot.entry.set ? ('printing' as const) : ('name' as const),
  }));
  return { result: { resolved, unresolved: [], warnings: storedWarnings(resolved) }, missing: [] };
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
): ApplyResult | null {
  const slots = applyStored(entries, data, profile);
  if (!slots) return null;
  if (slots.some((slot) => slot.card === null)) return null;
  return finish(slots);
}

/** The one client capability the lookup path needs: a batch fetch by printing. */
export interface PrintingLookup {
  collection(identifiers: readonly CardIdentifier[]): Promise<CollectionResponse>;
}

/**
 * Stored data, with the handful of printings it does not hold fetched directly.
 *
 * Pinning a card writes `(SET) NUM` into the list, which the stored file —
 * written before the pin existed — has no card for. Treating that as a failure
 * sends the whole deck back through preference resolution, one request per
 * distinct card, to re-decide ninety-nine printings that did not change. A
 * pinned line already names its printing exactly, so it needs looking up, not
 * ranking: one batched request covers every gap however many there are.
 *
 * Returns null when the data cannot be trusted at all, when a gap does not name
 * a printing — those genuinely have to be ranked — or when a named printing
 * does not exist, which the ranking path reports properly as a missed pin.
 */
export async function resolveFromDeckDataWithLookups(
  entries: readonly DeckEntry[],
  data: DeckData,
  client: PrintingLookup,
  profile: PreferenceProfile,
): Promise<ApplyResult | null> {
  const slots = applyStored(entries, data, profile);
  if (!slots) return null;

  const gaps = slots.filter((slot) => slot.card === null);
  if (gaps.some((slot) => !slot.entry.set || !slot.entry.collectorNumber)) return null;

  if (gaps.length > 0) {
    const response = await client.collection(
      gaps.map((slot) => ({
        set: slot.entry.set!,
        collector_number: slot.entry.collectorNumber!,
      })),
    );
    for (const slot of gaps) {
      // The name is checked as well as the printing: a hand-edited `(SET) NUM`
      // can point at a different card entirely, and resolving to it silently
      // would be worse than falling back to the path that reports a missed pin.
      const found = response.data.find(
        (card) => sameFacePrinting(card, slot.entry) && sameName(card, slot.entry),
      );
      if (!found) return null;
      slot.card = found;
    }
  }

  return finish(slots);
}
