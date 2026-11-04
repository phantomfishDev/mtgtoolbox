import type { ResolvedCard } from '../scryfall/resolve.js';
import type { ScryfallCard } from '../scryfall/types.js';
import { isDeckCard } from '../decklist/parse.js';
import { allOracleText, curveManaValue, hasLandBack, isLandCard } from './mana.js';

/**
 * Mana curve of a deck.
 *
 * The histogram is the easy part. The useful part is saying when it lies: a
 * printed curve is misleading whenever a deck cheats costs, so the caveats are
 * reported alongside rather than left for the reader to notice.
 */

/** Everything at this value or above shares a bucket; past here it is noise. */
export const CURVE_CAP = 7;

export interface CurveCard {
  name: string;
  quantity: number;
  manaValue: number;
}

export interface CurveBucket {
  /** Mana value, where {@link CURVE_CAP} means "this or more". */
  manaValue: number;
  label: string;
  /** Copies, not distinct cards. */
  count: number;
  cards: CurveCard[];
}

export type CaveatCode =
  | 'cost-reduction'
  | 'free-cast'
  | 'x-spell'
  | 'land-back'
  | 'cascade-or-suspend';

export interface CurveCaveat {
  code: CaveatCode;
  message: string;
  cards: string[];
}

export interface ManaCurve {
  buckets: CurveBucket[];
  /** Copies of nonland cards, which is what the curve is drawn from. */
  spells: number;
  lands: number;
  /** Mean mana value across nonland copies. */
  averageManaValue: number;
  /** Largest bucket, for scaling a chart. */
  peak: number;
  caveats: CurveCaveat[];
}

interface CaveatRule {
  code: CaveatCode;
  matches: (card: ScryfallCard) => boolean;
  message: (count: number) => string;
}

/**
 * Heuristics, and deliberately conservative ones.
 *
 * These flag cards worth a second look rather than claiming to compute a true
 * effective curve, which would need to know how a deck actually plays out.
 */
const CAVEAT_RULES: readonly CaveatRule[] = [
  {
    code: 'cost-reduction',
    matches: (card) => /\bcosts? \{?\d?\}?[^.]{0,24}less to cast/i.test(allOracleText(card)),
    message: (n) => `${n} card${n === 1 ? '' : 's'} reduce spell costs, so the real curve sits lower.`,
  },
  {
    code: 'free-cast',
    matches: (card) => /without paying (its|their) mana cost/i.test(allOracleText(card)),
    message: (n) => `${n} card${n === 1 ? '' : 's'} can cast spells without paying their cost.`,
  },
  {
    code: 'x-spell',
    matches: (card) => /\{X\}/.test(card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? ''),
    message: (n) => `${n} X spell${n === 1 ? '' : 's'} are charted at their printed value, which is their floor.`,
  },
  {
    code: 'land-back',
    matches: hasLandBack,
    message: (n) =>
      `${n} card${n === 1 ? '' : 's'} have a land on the back, so they count here as spells but can be played as lands.`,
  },
  {
    code: 'cascade-or-suspend',
    matches: (card) =>
      (card.keywords ?? []).some((keyword) => /^(cascade|suspend)$/i.test(keyword)),
    message: (n) => `${n} card${n === 1 ? '' : 's'} use cascade or suspend, which sidestep the printed cost.`,
  },
];

function bucketFor(manaValue: number): number {
  return Math.min(Math.max(Math.round(manaValue), 0), CURVE_CAP);
}

/**
 * Build the curve from resolved cards.
 *
 * Lands are excluded — a bar of 38 at zero would drown everything else — and
 * copies are counted rather than distinct cards, so nine of one card is nine.
 */
export function manaCurve(input: readonly ResolvedCard[]): ManaCurve {
  // A token has no mana value, so counting one would drag the average down and
  // pile every token into the 0 bucket.
  const resolved = input.filter((item) => isDeckCard(item.entry));
  const buckets: CurveBucket[] = Array.from({ length: CURVE_CAP + 1 }, (_, manaValue) => ({
    manaValue,
    label: manaValue === CURVE_CAP ? `${CURVE_CAP}+` : String(manaValue),
    count: 0,
    cards: [],
  }));

  let spells = 0;
  let lands = 0;
  let totalManaValue = 0;
  // Distinct cards, so a deck running nine of one card flags it once.
  const seen = new Map<string, ScryfallCard>();

  for (const item of resolved) {
    const quantity = item.entry.quantity;
    seen.set(item.card.name, item.card);

    if (isLandCard(item.card)) {
      lands += quantity;
      continue;
    }

    const manaValue = curveManaValue(item.card);
    const bucket = buckets[bucketFor(manaValue)]!;
    const existing = bucket.cards.find((entry) => entry.name === item.card.name);
    if (existing) existing.quantity += quantity;
    else bucket.cards.push({ name: item.card.name, quantity, manaValue });

    bucket.count += quantity;
    spells += quantity;
    totalManaValue += manaValue * quantity;
  }

  for (const bucket of buckets) {
    bucket.cards.sort((a, b) => a.name.localeCompare(b.name));
  }

  const caveats: CurveCaveat[] = [];
  for (const rule of CAVEAT_RULES) {
    const hits = [...seen.values()].filter(rule.matches).map((card) => card.name).sort();
    if (hits.length > 0) {
      caveats.push({ code: rule.code, message: rule.message(hits.length), cards: hits });
    }
  }

  return {
    buckets,
    spells,
    lands,
    averageManaValue: spells === 0 ? 0 : totalManaValue / spells,
    peak: Math.max(0, ...buckets.map((bucket) => bucket.count)),
    caveats,
  };
}
