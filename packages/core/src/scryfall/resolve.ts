import type { DeckEntry } from '../decklist/parse.js';
import type { ScryfallClient } from './client.js';
import type { CardIdentifier, ScryfallCard } from './types.js';
import { isDoubleFaced } from './types.js';

/** A deck entry successfully matched to a printing. */
export interface ResolvedCard {
  entry: DeckEntry;
  card: ScryfallCard;
  /** How the match was made, for reporting. */
  via: 'printing' | 'name' | 'fuzzy';
}

export interface UnresolvedCard {
  entry: DeckEntry;
  reason: string;
}

export interface ResolveWarning {
  entry: DeckEntry;
  card: ScryfallCard;
  code:
    | 'double-faced'
    | 'low-resolution'
    | 'digital-only'
    | 'pin-missed'
    | 'preferences-relaxed';
  message: string;
}

export interface ResolveResult {
  resolved: ResolvedCard[];
  unresolved: UnresolvedCard[];
  warnings: ResolveWarning[];
}

function identifierFor(entry: DeckEntry): CardIdentifier {
  if (entry.set && entry.collectorNumber) {
    return { set: entry.set, collector_number: entry.collectorNumber };
  }
  return { name: entry.name };
}

function matches(card: ScryfallCard, entry: DeckEntry): boolean {
  if (entry.set && entry.collectorNumber) {
    return (
      card.set.toLowerCase() === entry.set.toLowerCase() &&
      card.collector_number.toLowerCase() === entry.collectorNumber.toLowerCase()
    );
  }
  const wanted = entry.name.toLowerCase();
  if (card.name.toLowerCase() === wanted) return true;
  // A double-faced card may be listed by its front face alone.
  const front = card.card_faces?.[0]?.name?.toLowerCase();
  return front === wanted;
}

/**
 * Match every deck entry to a printing.
 *
 * Batches through `POST /cards/collection` first, then retries whatever missed
 * via fuzzy single-card lookup — which rescues typos and front-face-only names
 * for double-faced cards.
 */
export async function resolveDeck(
  entries: readonly DeckEntry[],
  client: ScryfallClient,
): Promise<ResolveResult> {
  const resolved: ResolvedCard[] = [];
  const unresolved: UnresolvedCard[] = [];
  const warnings: ResolveWarning[] = [];

  const identifiers = entries.map(identifierFor);
  const response = await client.collection(identifiers);

  const leftovers: DeckEntry[] = [];
  for (const entry of entries) {
    const card = response.data.find((candidate) => matches(candidate, entry));
    if (card) resolved.push({ entry, card, via: entry.set ? 'printing' : 'name' });
    else leftovers.push(entry);
  }

  for (const entry of leftovers) {
    const card = await client.named(entry.name);
    if (card) {
      resolved.push({ entry, card, via: 'fuzzy' });
    } else {
      const printing = entry.set ? ` (${entry.set.toUpperCase()} ${entry.collectorNumber})` : '';
      unresolved.push({ entry, reason: `no Scryfall match for "${entry.name}"${printing}` });
    }
  }

  for (const item of resolved) {
    // v1 prints the front face only. Warn rather than drop the back silently.
    if (isDoubleFaced(item.card)) {
      warnings.push({
        entry: item.entry,
        card: item.card,
        code: 'double-faced',
        message: `${item.card.name} is double-faced; only the front face will be printed`,
      });
    }
    if (item.card.image_status !== 'highres_scan') {
      warnings.push({
        entry: item.entry,
        card: item.card,
        code: 'low-resolution',
        message: `${item.card.name} (${item.card.set.toUpperCase()}) has a ${item.card.image_status} image and will print poorly`,
      });
    }
    if (item.card.digital) {
      warnings.push({
        entry: item.entry,
        card: item.card,
        code: 'digital-only',
        message: `${item.card.name} (${item.card.set.toUpperCase()}) is a digital-only printing`,
      });
    }
  }

  // Preserve decklist order, which keeps generated PDFs stable across runs.
  const order = new Map(entries.map((entry, index) => [entry, index]));
  resolved.sort((a, b) => (order.get(a.entry) ?? 0) - (order.get(b.entry) ?? 0));

  return { resolved, unresolved, warnings };
}
