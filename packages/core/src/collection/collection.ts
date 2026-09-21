import type { ScryfallCard } from '../scryfall/types.js';
import {
  DEFAULT_LANGUAGE,
  entryKey,
  normalizeName,
  sortEntries,
  type Collection,
  type CollectionEntry,
  type Finish,
} from './types.js';

/**
 * Pure operations over a collection.
 *
 * Every function returns a new collection rather than mutating in place, so the
 * caller decides when a change reaches disk. That keeps a failed write from
 * leaving the in-memory state ahead of the file.
 */

function touch(collection: Collection, cards: CollectionEntry[]): Collection {
  return { version: collection.version, updatedAt: new Date().toISOString(), cards: sortEntries(cards) };
}

export interface AddOptions {
  quantity?: number;
  finish?: Finish;
  tags?: string[];
  note?: string;
}

/** Build an entry from a resolved Scryfall printing. */
export function entryFromCard(card: ScryfallCard, options: AddOptions = {}): CollectionEntry {
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
export function addEntry(collection: Collection, entry: CollectionEntry): Collection {
  const key = entryKey(entry);
  const cards = [...collection.cards];
  const index = cards.findIndex((candidate) => entryKey(candidate) === key);
  if (index === -1) {
    cards.push(entry);
  } else {
    const existing = cards[index]!;
    cards[index] = { ...existing, quantity: existing.quantity + entry.quantity };
  }
  return touch(collection, cards);
}

/**
 * Remove copies of a printing.
 *
 * Removing more copies than are held empties the entry rather than erroring, so
 * that `remove -q 99` reliably clears a card.
 */
export function removeEntry(
  collection: Collection,
  target: Pick<CollectionEntry, 'name' | 'set' | 'collectorNumber' | 'finish' | 'language'>,
  quantity = Number.POSITIVE_INFINITY,
): { collection: Collection; removed: number } {
  const key = entryKey(target);
  const cards: CollectionEntry[] = [];
  let removed = 0;
  for (const entry of collection.cards) {
    if (entryKey(entry) !== key) {
      cards.push(entry);
      continue;
    }
    const take = Math.min(entry.quantity, quantity);
    removed += take;
    if (entry.quantity - take > 0) cards.push({ ...entry, quantity: entry.quantity - take });
  }
  return { collection: touch(collection, cards), removed };
}

/** Every entry whose name matches, regardless of printing. */
export function findByName(collection: Collection, name: string): CollectionEntry[] {
  const wanted = normalizeName(name);
  return collection.cards.filter((entry) => normalizeName(entry.name) === wanted);
}

/** Substring search across names and tags. */
export function searchCollection(collection: Collection, query: string): CollectionEntry[] {
  const needle = normalizeName(query);
  return collection.cards.filter(
    (entry) =>
      normalizeName(entry.name).includes(needle) ||
      entry.tags?.some((tag) => normalizeName(tag).includes(needle)),
  );
}

/** Total copies held of a card, across all printings and finishes. */
export function ownedCount(collection: Collection, name: string): number {
  return findByName(collection, name).reduce((sum, entry) => sum + entry.quantity, 0);
}

export interface CollectionStats {
  distinctPrintings: number;
  distinctNames: number;
  totalCards: number;
  bySet: { set: string; count: number }[];
  byFinish: Record<Finish, number>;
}

export function collectionStats(collection: Collection): CollectionStats {
  const names = new Set<string>();
  const sets = new Map<string, number>();
  const byFinish = { nonfoil: 0, foil: 0, etched: 0 } as Record<Finish, number>;
  let total = 0;

  for (const entry of collection.cards) {
    names.add(normalizeName(entry.name));
    sets.set(entry.set, (sets.get(entry.set) ?? 0) + entry.quantity);
    byFinish[entry.finish] += entry.quantity;
    total += entry.quantity;
  }

  return {
    distinctPrintings: collection.cards.length,
    distinctNames: names.size,
    totalCards: total,
    bySet: [...sets.entries()]
      .map(([set, count]) => ({ set, count }))
      .sort((a, b) => b.count - a.count || a.set.localeCompare(b.set)),
    byFinish,
  };
}
