import type { ScryfallCard } from '../scryfall/types.js';

/**
 * Mana value and card-type questions that need the *front* face.
 *
 * Scryfall's top-level fields describe the whole card, which is the wrong
 * answer twice over: `type_line` on a modal double-faced card reads
 * `Instant // Land`, and `cmc` on a split card is the sum of both halves. Both
 * would misplace cards in a curve, so these helpers look at the face you
 * actually cast from hand.
 */

/** The front face's type line, falling back to the card's own. */
export function frontTypeLine(card: ScryfallCard): string {
  return card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
}

/** The front face's oracle text, plus the back's, since both can matter. */
export function allOracleText(card: ScryfallCard): string {
  const faces = card.card_faces?.map((face) => face.oracle_text ?? '') ?? [];
  return [card.oracle_text ?? '', ...faces].join('\n');
}

/**
 * True when the card is played as a land.
 *
 * Judged from the front face: a spell whose back face is a land is a spell,
 * because that is the half you cast.
 */
export function isLandCard(card: ScryfallCard): boolean {
  return /\bLand\b/.test(frontTypeLine(card));
}

/** True when the back face is a land but the front is not — an MDFC land. */
export function hasLandBack(card: ScryfallCard): boolean {
  const back = card.card_faces?.[1]?.type_line ?? '';
  return back !== '' && /\bLand\b/.test(back) && !isLandCard(card);
}

/**
 * Mana value of a printed cost such as `{2}{W}{W}` or `{X}{B}{B}{B}`.
 *
 * `{X}` counts as zero, which is the convention everywhere off the stack, and
 * hybrid or Phyrexian symbols count as one each.
 */
export function manaValueOf(cost: string | undefined): number {
  if (!cost) return 0;
  let total = 0;
  for (const [, symbol] of cost.matchAll(/\{([^}]+)\}/g)) {
    const token = symbol ?? '';
    if (token === 'X' || token === 'Y' || token === 'Z') continue;
    const generic = Number.parseInt(token, 10);
    // A hybrid or Phyrexian symbol such as {W/U} or {W/P} is worth one.
    total += Number.isFinite(generic) ? generic : 1;
  }
  return total;
}

/**
 * The mana value a curve should use.
 *
 * Split cards are the exception: Scryfall reports their combined cost, but you
 * cast one half, so the front half is the honest number. Everything else —-
 * including modal and transforming double-faced cards — already reports the
 * front face's value.
 */
export function curveManaValue(card: ScryfallCard): number {
  if (card.layout === 'split' || card.layout === 'adventure') {
    const front = card.card_faces?.[0];
    if (front) return front.cmc ?? manaValueOf(front.mana_cost);
  }
  return card.cmc ?? manaValueOf(card.mana_cost);
}
