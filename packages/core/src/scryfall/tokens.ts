import type { TokenRow } from '../decklist/tokens.js';
import { tokenIdentity } from '../decklist/tokens.js';
import type { ScryfallClient } from './client.js';
import { isTokenCard, tokenParts, type ScryfallCard } from './types.js';

/** A token some card in the deck makes, and which cards make it. */
export interface FoundToken {
  card: ScryfallCard;
  /** Names of the deck's cards that name this token, sorted. */
  madeBy: string[];
}

/**
 * The tokens a set of cards can make, one per distinct token.
 *
 * Driven entirely by Scryfall's `all_parts`, so nothing is hardcoded. Stored
 * deck data is trimmed and has no `all_parts`, so the cards are re-read by id
 * first: one request per 75 cards, then one more per 75 tokens.
 *
 * Two cards can name different printings of the same token; those collapse
 * into one, keeping the first printing seen and every card that makes it.
 */
export async function findTokens(
  cards: readonly ScryfallCard[],
  client: ScryfallClient,
): Promise<FoundToken[]> {
  const ids = [...new Set(cards.map((card) => card.id))].map((id) => ({ id }));
  if (ids.length === 0) return [];
  const full = (await client.collection(ids)).data;

  const makers = new Map<string, Set<string>>();
  for (const card of full) {
    for (const part of tokenParts(card)) {
      // A token lists itself among its own parts; that is not a maker.
      if (part.id === card.id) continue;
      const names = makers.get(part.id) ?? new Set<string>();
      names.add(card.name);
      makers.set(part.id, names);
    }
  }
  if (makers.size === 0) return [];

  const tokens = (await client.collection([...makers.keys()].map((id) => ({ id })))).data;

  const distinct = new Map<string, FoundToken>();
  for (const token of tokens) {
    const identity = tokenIdentity(token);
    const madeBy = makers.get(token.id) ?? new Set<string>();
    const existing = distinct.get(identity);
    if (existing) {
      existing.madeBy = [...new Set([...existing.madeBy, ...madeBy])].sort();
    } else {
      distinct.set(identity, { card: token, madeBy: [...madeBy].sort() });
    }
  }
  return [...distinct.values()].sort((a, b) => a.card.name.localeCompare(b.card.name));
}

/**
 * The printing each pinned row names, by index, so rows can be compared with
 * found tokens. Rows without a pin, or whose pin Scryfall does not know, map
 * to undefined. One request per 75 rows, and served from the card cache after.
 */
export async function lookupTokenRows(
  rows: readonly TokenRow[],
  client: ScryfallClient,
): Promise<(ScryfallCard | undefined)[]> {
  const key = (set: string, number: string) => `${set.toLowerCase()}|${number.toLowerCase()}`;
  const pinned = rows.filter((row) => row.set && row.collectorNumber);
  if (pinned.length === 0) return rows.map(() => undefined);

  const { data } = await client.collection(
    pinned.map((row) => ({ set: row.set!, collector_number: row.collectorNumber! })),
  );
  const byPrinting = new Map(data.map((card) => [key(card.set, card.collector_number), card]));
  return rows.map((row) =>
    row.set && row.collectorNumber ? byPrinting.get(key(row.set, row.collectorNumber)) : undefined,
  );
}

/**
 * Every printing of one token, for choosing its art.
 *
 * Token printings are hidden from search unless asked for, and a token's name
 * is shared by tokens that are not the same token — four different Elementals,
 * a 2/2 and a 4/4 Bear — so the search is narrowed to printings with the same
 * identity as `token`. The printing in use is always included, so a token with
 * one printing still offers that one.
 *
 * The token is re-read by id before comparing: stored deck data is trimmed and
 * keeps no power or toughness, so a stored 3/3 would match no search result.
 */
export async function tokenPrintings(
  token: ScryfallCard,
  client: ScryfallClient,
): Promise<ScryfallCard[]> {
  const full = (await client.collection([{ id: token.id }])).data[0] ?? token;
  const identity = tokenIdentity(full);
  const printings = (await client.prints(token.name, { extras: true })).filter(
    (card) => isTokenCard(card) && tokenIdentity(card) === identity,
  );
  return printings.some((card) => card.id === token.id) ? printings : [token, ...printings];
}
