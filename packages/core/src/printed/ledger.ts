import type { ScryfallCard } from '../scryfall/types.js';
import {
  DEFAULT_LANGUAGE,
  entryKey,
  normalizeName,
  sortEntries,
  type Finish,
  type PrintedEntry,
  type PrintedLedger,
} from './types.js';

/**
 * Pure operations over the printed ledger.
 *
 * Every function returns a new ledger rather than mutating in place, so the
 * caller decides when a change reaches disk. That keeps a failed write from
 * leaving the in-memory state ahead of the file — which matters more here than
 * it would for a read-only cache, because a ledger that claims you printed
 * something you did not is a card missing from a deck.
 */

function touch(ledger: PrintedLedger, cards: PrintedEntry[]): PrintedLedger {
  return { version: ledger.version, updatedAt: new Date().toISOString(), cards: sortEntries(cards) };
}

export interface AddOptions {
  quantity?: number;
  finish?: Finish;
  tags?: string[];
  note?: string;
}

/** Build an entry from a resolved Scryfall printing. */
export function entryFromCard(card: ScryfallCard, options: AddOptions = {}): PrintedEntry {
  return {
    name: card.name,
    set: card.set.toLowerCase(),
    collectorNumber: card.collector_number,
    finish: options.finish ?? 'nonfoil',
    quantity: options.quantity ?? 1,
    ...(card.lang && card.lang !== DEFAULT_LANGUAGE ? { language: card.lang } : {}),
    scryfallId: card.id,
    addedAt: new Date().toISOString(),
    ...(options.tags?.length ? { tags: options.tags } : {}),
    ...(options.note ? { note: options.note } : {}),
  };
}

/** Add copies, merging into an existing entry for the same printing and finish. */
export function addEntry(ledger: PrintedLedger, entry: PrintedEntry): PrintedLedger {
  const key = entryKey(entry);
  const cards = [...ledger.cards];
  const index = cards.findIndex((candidate) => entryKey(candidate) === key);
  if (index === -1) {
    cards.push(entry);
  } else {
    const existing = cards[index]!;
    cards[index] = { ...existing, quantity: existing.quantity + entry.quantity };
  }
  return touch(ledger, cards);
}

/**
 * Record several printings at once, which is what a finished print run is.
 *
 * Merging happens per printing, so printing nine Nazgûl across nine arts adds
 * nine entries of one, while printing the same art nine times adds one entry
 * of nine.
 */
export function addEntries(
  ledger: PrintedLedger,
  entries: readonly PrintedEntry[],
): PrintedLedger {
  return entries.reduce((current, entry) => addEntry(current, entry), ledger);
}

/**
 * Remove copies of a printing.
 *
 * Removing more copies than are held empties the entry rather than erroring, so
 * that a large quantity reliably clears a card.
 */
export function removeEntry(
  ledger: PrintedLedger,
  target: Pick<PrintedEntry, 'name' | 'set' | 'collectorNumber' | 'finish' | 'language'>,
  quantity = Number.POSITIVE_INFINITY,
): { ledger: PrintedLedger; removed: number } {
  const key = entryKey(target);
  const cards: PrintedEntry[] = [];
  let removed = 0;
  for (const entry of ledger.cards) {
    if (entryKey(entry) !== key) {
      cards.push(entry);
      continue;
    }
    const take = Math.min(entry.quantity, quantity);
    removed += take;
    if (entry.quantity - take > 0) cards.push({ ...entry, quantity: entry.quantity - take });
  }
  return { ledger: touch(ledger, cards), removed };
}

/** Every entry whose name matches, regardless of printing. */
export function findByName(ledger: PrintedLedger, name: string): PrintedEntry[] {
  const wanted = normalizeName(name);
  return ledger.cards.filter((entry) => normalizeName(entry.name) === wanted);
}

/** Total copies printed of a card, across all printings and finishes. */
export function printedCount(ledger: PrintedLedger, name: string): number {
  return findByName(ledger, name).reduce((sum, entry) => sum + entry.quantity, 0);
}
