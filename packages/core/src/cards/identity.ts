import type { ScryfallCard } from '../scryfall/types.js';

/**
 * Small helpers for telling cards apart: matching names the way hand-typed
 * lists write them, ordering collector numbers, and spotting basic lands.
 */

/**
 * Normalise a card name for matching.
 *
 * Case and surrounding whitespace are insignificant, and the curly apostrophe
 * Scryfall uses in names like "Praetors' Voice" is folded to a straight one so
 * that hand-typed lists match.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/’/g, "'");
}

/** The front-face name of a double-faced card, for matching lists that omit the back. */
export function frontName(name: string): string {
  const index = name.indexOf('//');
  return index === -1 ? normalizeName(name) : normalizeName(name.slice(0, index));
}

/**
 * Compare collector numbers so that "10" sorts after "9".
 *
 * Numbers can carry letter suffixes ("123a") and stars ("★"), so the numeric
 * prefix is compared first and the remainder breaks ties.
 */
export function compareCollectorNumbers(a: string, b: string): number {
  const parse = (value: string): [number, string] => {
    const match = value.match(/^(\d+)(.*)$/);
    return match ? [Number.parseInt(match[1]!, 10), match[2] ?? ''] : [Number.POSITIVE_INFINITY, value];
  };
  const [numberA, restA] = parse(a);
  const [numberB, restB] = parse(b);
  return numberA - numberB || restA.localeCompare(restB);
}

/**
 * Basic lands are identified from the type line rather than a name list, so
 * that Snow-Covered basics and Wastes are handled without special cases.
 */
export function isBasicLand(card: ScryfallCard): boolean {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  return /\bBasic\b/.test(typeLine) && /\bLand\b/.test(typeLine);
}
