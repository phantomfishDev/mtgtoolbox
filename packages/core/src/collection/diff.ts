import type { ResolvedCard } from '../scryfall/resolve.js';
import type { ScryfallCard } from '../scryfall/types.js';
import { frontName, normalizeName, type Collection, type CollectionEntry } from './types.js';

/**
 * Work out which cards a deck needs that the collection does not already hold.
 */

export interface DiffOptions {
  /** Require the exact printing, not merely the same card. Default: false. */
  strictPrinting?: boolean;
  /** Require the finish to match too. Default: false. */
  matchFinish?: boolean;
  /** Treat basic lands as always owned. Default: true. */
  assumeBasics?: boolean;
}

export interface DiffRow {
  card: ScryfallCard;
  needed: number;
  owned: number;
  missing: number;
  isBasic: boolean;
  /** Collection entries that satisfied this row, for reporting. */
  matched: CollectionEntry[];
}

export interface DeckDiff {
  rows: DiffRow[];
  totalNeeded: number;
  totalOwned: number;
  totalMissing: number;
}

/**
 * Basic lands are identified from the type line rather than a name list, so
 * that Snow-Covered basics and Wastes are handled without special cases.
 */
export function isBasicLand(card: ScryfallCard): boolean {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  return /\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine);
}

function matchKeys(card: ScryfallCard, options: DiffOptions): string[] {
  if (options.strictPrinting) {
    return [`${card.set.toLowerCase()}|${card.collector_number.toLowerCase()}`];
  }
  // Match on the full name and on the front face, so a list that writes only
  // "Malakir Rebirth" still matches a collection holding the full DFC name.
  return [...new Set([normalizeName(card.name), frontName(card.name)])];
}

function entryKeys(entry: CollectionEntry, options: DiffOptions): string[] {
  if (options.strictPrinting) {
    return [`${entry.set.toLowerCase()}|${entry.collectorNumber.toLowerCase()}`];
  }
  return [...new Set([normalizeName(entry.name), frontName(entry.name)])];
}

/**
 * Diff a resolved deck against a collection.
 *
 * Owned copies are consumed as they are allocated, so two rows that want the
 * same card cannot both claim the same physical copy.
 */
export function diffDeck(
  resolved: readonly ResolvedCard[],
  collection: Collection,
  options: DiffOptions = {},
): DeckDiff {
  const assumeBasics = options.assumeBasics ?? true;

  // Build a pool of available copies, indexed by every key an entry can match.
  const pool = new Map<string, { remaining: number; entry: CollectionEntry }[]>();
  for (const entry of collection.cards) {
    if (options.matchFinish && entry.finish !== 'nonfoil') continue;
    const record = { remaining: entry.quantity, entry };
    for (const key of entryKeys(entry, options)) {
      const bucket = pool.get(key);
      if (bucket) bucket.push(record);
      else pool.set(key, [record]);
    }
  }

  const rows: DiffRow[] = [];
  for (const item of resolved) {
    const needed = item.entry.quantity;
    const isBasic = isBasicLand(item.card);

    if (isBasic && assumeBasics) {
      rows.push({ card: item.card, needed, owned: needed, missing: 0, isBasic, matched: [] });
      continue;
    }

    let owned = 0;
    const matched: CollectionEntry[] = [];
    // A record can appear under several keys; `seen` stops it being drawn twice.
    const seen = new Set<{ remaining: number; entry: CollectionEntry }>();
    for (const key of matchKeys(item.card, options)) {
      for (const record of pool.get(key) ?? []) {
        if (owned >= needed) break;
        if (seen.has(record) || record.remaining === 0) continue;
        seen.add(record);
        const take = Math.min(record.remaining, needed - owned);
        record.remaining -= take;
        owned += take;
        if (take > 0) matched.push(record.entry);
      }
    }

    rows.push({ card: item.card, needed, owned, missing: needed - owned, isBasic, matched });
  }

  return {
    rows,
    totalNeeded: rows.reduce((sum, row) => sum + row.needed, 0),
    totalOwned: rows.reduce((sum, row) => sum + row.owned, 0),
    totalMissing: rows.reduce((sum, row) => sum + row.missing, 0),
  };
}

/**
 * Reduce a resolved deck to only the copies that are missing, preserving order.
 * Rows fully covered by the collection drop out entirely.
 *
 * Rows are paired with cards by position rather than by printing, because a
 * deck can legitimately list one printing across several rows — nine copies of
 * a card each choosing their own art, say — and keying on the printing would
 * make those rows collide and share one row's count.
 */
export function missingOnly(
  resolved: readonly ResolvedCard[],
  diff: DeckDiff,
): ResolvedCard[] {
  const out: ResolvedCard[] = [];
  resolved.forEach((item, index) => {
    const missing = diff.rows[index]?.missing ?? item.entry.quantity;
    if (missing > 0) out.push({ ...item, entry: { ...item.entry, quantity: missing } });
  });
  return out;
}
