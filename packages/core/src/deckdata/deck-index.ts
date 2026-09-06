import { z } from 'zod';
import { commanders, type DeckEntry } from '../decklist/parse.js';
import { normalizeName } from '../collection/types.js';
import type { ResolvedCard } from '../scryfall/resolve.js';
import type { ScryfallCard } from '../scryfall/types.js';
import { assessBracket, BRACKET_NAMES, type Bracket } from '../analysis/bracket.js';
import { profileFingerprint } from './build.js';
import type { PreferenceProfile } from '../printing/profile.js';

/**
 * A summary of every deck, for the deck list.
 *
 * The list needs a little from each deck — a commander image, colours, a
 * bracket, how many cards are owned — and loading every deck's full card data
 * to get it would be about a megabyte before the page could render. This holds
 * only what the list shows, in one small file.
 */

export const DECK_INDEX_VERSION = 1;
export const DECK_INDEX_FILENAME = 'decks.index.json';

const IndexCard = z.object({
  name: z.string(),
  quantity: z.number().int().positive(),
  set: z.string(),
  collectorNumber: z.string(),
  typeLine: z.string(),
});

const IndexEntry = z.object({
  id: z.string(),
  cardCount: z.number().int().nonnegative(),
  colorIdentity: z.array(z.string()),
  bracket: z.number().int().min(1).max(5),
  bracketName: z.string(),
  commanders: z.array(z.object({ name: z.string(), image: z.string().optional() })),
  /** Enough of each card to count what is owned, without the full card data. */
  cards: z.array(IndexCard),
});

export const DeckIndexSchema = z.object({
  version: z.literal(DECK_INDEX_VERSION),
  generatedAt: z.string(),
  profile: z.string(),
  decks: z.array(IndexEntry),
});

export type DeckIndexCard = z.infer<typeof IndexCard>;
export type DeckIndexEntry = z.infer<typeof IndexEntry>;
export type DeckIndex = z.infer<typeof DeckIndexSchema>;

export function parseDeckIndex(data: unknown): DeckIndex {
  const result = DeckIndexSchema.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`,
  );
  throw new Error(`deck index is invalid:\n${lines.join('\n')}`);
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

/** Sort colours into WUBRG order, which is how Magic always writes them. */
export function sortColors(colors: Iterable<string>): string[] {
  return [...new Set(colors)].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b));
}

/**
 * A deck's colours.
 *
 * In Commander the deck's identity is its commander's, which is also the rule
 * the deck was built under. Only when a list declares no commander does this
 * fall back to the union of everything in it.
 */
export function deckColorIdentity(
  resolved: readonly ResolvedCard[],
  commanderNames: readonly string[],
): string[] {
  const wanted = new Set(commanderNames.map(normalizeName));
  const source =
    wanted.size > 0
      ? resolved.filter((item) => wanted.has(normalizeName(item.card.name)))
      : resolved;
  return sortColors(source.flatMap((item) => item.card.color_identity ?? []));
}

function frontTypeLine(card: ScryfallCard): string {
  return card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
}

function commanderImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

export function buildDeckIndexEntry(
  id: string,
  entries: readonly DeckEntry[],
  resolved: readonly ResolvedCard[],
  cardCount: number,
): DeckIndexEntry {
  const commanderNames = commanders(entries).map((entry) => entry.name);
  const byName = new Map(resolved.map((item) => [normalizeName(item.card.name), item.card]));
  const assessment = assessBracket(resolved);

  return {
    id,
    cardCount,
    colorIdentity: deckColorIdentity(resolved, commanderNames),
    bracket: assessment.bracket,
    bracketName: BRACKET_NAMES[assessment.bracket as Bracket],
    commanders: commanderNames.map((name) => {
      const card = byName.get(normalizeName(name));
      const image = card ? commanderImage(card) : undefined;
      return { name: card?.name ?? name, ...(image ? { image } : {}) };
    }),
    cards: resolved.map((item) => ({
      name: item.card.name,
      quantity: item.entry.quantity,
      set: item.card.set,
      collectorNumber: item.card.collector_number,
      typeLine: frontTypeLine(item.card),
    })),
  };
}

export function buildDeckIndex(
  decks: readonly DeckIndexEntry[],
  profile: PreferenceProfile,
): DeckIndex {
  return {
    version: DECK_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    profile: profileFingerprint(profile),
    decks: [...decks].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Index cards as resolved cards, so the list can run the same diff the deck
 * view does and the two can never report different owned counts.
 */
export function indexCardsToResolved(cards: readonly DeckIndexCard[]): ResolvedCard[] {
  return cards.map((card, line) => ({
    entry: { quantity: card.quantity, name: card.name, line, raw: `${card.quantity} ${card.name}` },
    card: {
      id: `${card.set}-${card.collectorNumber}`,
      name: card.name,
      set: card.set,
      collector_number: card.collectorNumber,
      type_line: card.typeLine,
    } as ScryfallCard,
    via: 'name' as const,
  }));
}
