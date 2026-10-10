import type { ResolvedCard } from '../scryfall/resolve.js';
import {
  faceImageUrl,
  isDoubleFaced,
  type CardFaceSide,
  type ImageQuality,
} from '../scryfall/types.js';

/**
 * One image to place on a sheet, with how many placements it needs.
 *
 * The CLI and the web app both build their print sheets from this, so that a
 * decklist produces the same pages whichever one rendered it.
 */
export interface PrintPlacement {
  /** Distinct per printing *and* face, so each image is embedded exactly once. */
  key: string;
  url: string;
  quantity: number;
  name: string;
  side: CardFaceSide;
}

export interface PlacementOptions {
  quality: ImageQuality;
  /**
   * Print the back of every double-faced card too, one back per copy, placed
   * directly after its front. Off by default: most people want the faces they
   * can cast, and a deck of modal lands doubles its page count otherwise.
   */
  bothFaces?: boolean;
}

export interface PlacementResult {
  placements: PrintPlacement[];
  /** Cards left off the sheet, each with the reason, for the caller to report. */
  skipped: string[];
}

/**
 * Work out which images a sheet needs.
 *
 * Copies of one printing collapse into a single placement carrying the count,
 * which is what stops a deck running sixteen Plains from embedding the same
 * artwork sixteen times.
 */
export function printPlacements(
  cards: readonly ResolvedCard[],
  options: PlacementOptions,
): PlacementResult {
  const { quality, bothFaces = false } = options;
  const byKey = new Map<string, PrintPlacement>();
  const order: string[] = [];
  const skipped: string[] = [];
  /** Reported once per printing, not once per copy. */
  const seenCards = new Set<string>();

  for (const item of cards) {
    const { card } = item;
    const quantity = item.entry.quantity;
    const sides: CardFaceSide[] = bothFaces && isDoubleFaced(card) ? ['front', 'back'] : ['front'];

    for (const side of sides) {
      const key = `${card.id}:${side}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += quantity;
        continue;
      }
      const url = faceImageUrl(card, quality, side);
      if (!url) {
        if (!seenCards.has(key)) {
          seenCards.add(key);
          const what = side === 'back' ? 'back face' : 'image';
          skipped.push(`${card.name} (${card.set.toUpperCase()}) has no printable ${what}`);
        }
        continue;
      }
      const name = side === 'back' ? (card.card_faces?.[1]?.name ?? card.name) : card.name;
      byKey.set(key, { key, url, quantity, name, side });
      order.push(key);
    }
  }

  return { placements: order.map((key) => byKey.get(key)!), skipped };
}

/** How many cards a sheet will hold, counting both faces where asked for. */
export function placementCount(placements: readonly PrintPlacement[]): number {
  return placements.reduce((sum, item) => sum + item.quantity, 0);
}
