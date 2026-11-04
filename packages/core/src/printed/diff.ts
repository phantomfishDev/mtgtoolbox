import type { ResolvedCard } from '../scryfall/resolve.js';
import type { ScryfallCard } from '../scryfall/types.js';
import { frontName, normalizeName, type PrintedEntry, type PrintedLedger } from './types.js';

/**
 * Work out which cards a deck needs that have not been printed yet.
 */

export interface DiffOptions {
  /**
   * Require the exact printing, not merely the same card. Default: true.
   *
   * On by default because this ledger records *printings*: choosing a new art
   * for a card you have already printed is a new card to print, not a card you
   * are done with.
   */
  strictPrinting?: boolean;
  /** Require the finish to match too. Default: false. */
  matchFinish?: boolean;
  /**
   * Treat basic lands as already printed. Default: false.
   *
   * Off by default, which is the opposite of what an ownership check would
   * want: a proxy deck needs its basics printed along with everything else.
   */
  assumeBasics?: boolean;
}

export interface DiffRow {
  card: ScryfallCard;
  needed: number;
  printed: number;
  toPrint: number;
  isBasic: boolean;
  /** Ledger entries that satisfied this row, for reporting. */
  matched: PrintedEntry[];
}

export interface DeckDiff {
  rows: DiffRow[];
  totalNeeded: number;
  totalPrinted: number;
  totalToPrint: number;
}

/**
 * Basic lands are identified from the type line rather than a name list, so
 * that Snow-Covered basics and Wastes are handled without special cases.
 */
export function isBasicLand(card: ScryfallCard): boolean {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  return /\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine);
}

function matchKeys(card: ScryfallCard, strictPrinting: boolean): string[] {
  if (strictPrinting) {
    return [`${card.set.toLowerCase()}|${card.collector_number.toLowerCase()}`];
  }
  // Match on the full name and on the front face, so a list that writes only
  // "Malakir Rebirth" still matches a ledger holding the full DFC name.
  return [...new Set([normalizeName(card.name), frontName(card.name)])];
}

function entryKeys(entry: PrintedEntry, strictPrinting: boolean): string[] {
  if (strictPrinting) {
    return [`${entry.set.toLowerCase()}|${entry.collectorNumber.toLowerCase()}`];
  }
  return [...new Set([normalizeName(entry.name), frontName(entry.name)])];
}

/**
 * Diff a resolved deck against the printed ledger.
 *
 * Printed copies are consumed as they are allocated, so two rows that want the
 * same printing cannot both claim the same sheet.
 */
export function diffDeck(
  resolved: readonly ResolvedCard[],
  ledger: PrintedLedger,
  options: DiffOptions = {},
): DeckDiff {
  const assumeBasics = options.assumeBasics ?? false;
  const strictPrinting = options.strictPrinting ?? true;

  // Build a pool of printed copies, indexed by every key an entry can match.
  const pool = new Map<string, { remaining: number; entry: PrintedEntry }[]>();
  for (const entry of ledger.cards) {
    if (options.matchFinish && entry.finish !== 'nonfoil') continue;
    const record = { remaining: entry.quantity, entry };
    for (const key of entryKeys(entry, strictPrinting)) {
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
      rows.push({ card: item.card, needed, printed: needed, toPrint: 0, isBasic, matched: [] });
      continue;
    }

    let printed = 0;
    const matched: PrintedEntry[] = [];
    // A record can appear under several keys; `seen` stops it being drawn twice.
    const seen = new Set<{ remaining: number; entry: PrintedEntry }>();
    for (const key of matchKeys(item.card, strictPrinting)) {
      for (const record of pool.get(key) ?? []) {
        if (printed >= needed) break;
        if (seen.has(record) || record.remaining === 0) continue;
        seen.add(record);
        const take = Math.min(record.remaining, needed - printed);
        record.remaining -= take;
        printed += take;
        if (take > 0) matched.push(record.entry);
      }
    }

    rows.push({ card: item.card, needed, printed, toPrint: needed - printed, isBasic, matched });
  }

  return {
    rows,
    totalNeeded: rows.reduce((sum, row) => sum + row.needed, 0),
    totalPrinted: rows.reduce((sum, row) => sum + row.printed, 0),
    totalToPrint: rows.reduce((sum, row) => sum + row.toPrint, 0),
  };
}

/**
 * Reduce a resolved deck to only the copies still to print, preserving order.
 * Rows already fully printed drop out entirely.
 *
 * Rows are paired with cards by position rather than by printing, because a
 * deck can legitimately list one printing across several rows — nine copies of
 * a card each choosing their own art, say — and keying on the printing would
 * make those rows collide and share one row's count.
 */
export function unprintedOnly(
  resolved: readonly ResolvedCard[],
  diff: DeckDiff,
): ResolvedCard[] {
  const out: ResolvedCard[] = [];
  resolved.forEach((item, index) => {
    const toPrint = diff.rows[index]?.toPrint ?? item.entry.quantity;
    if (toPrint > 0) out.push({ ...item, entry: { ...item.entry, quantity: toPrint } });
  });
  return out;
}
