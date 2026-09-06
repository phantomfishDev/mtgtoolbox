import { z } from 'zod';
import type { ScryfallCard } from '../scryfall/types.js';

/**
 * Card data stored alongside a decklist.
 *
 * A deck's cards are otherwise re-fetched from Scryfall every time it is opened
 * somewhere new — one request per distinct card, about a minute for a hundred
 * of them. Keeping the resolved printings next to the list makes that a local
 * read instead.
 *
 * Only the chosen printings are stored, not every printing of every card:
 * measured on a 54-card deck, all printings come to roughly 1.5 MB trimmed
 * against 60 KB for the chosen ones. The cost of that choice is that the file
 * is only valid for the preference profile that produced it, which is why the
 * profile fingerprint is recorded and checked.
 *
 * Image *bytes* are never stored — only the URLs Scryfall serves them from.
 */

export const DECK_DATA_VERSION = 1;

/** The card fields this project actually reads; everything else is dropped. */
export const STORED_CARD_FIELDS = [
  'id',
  'oracle_id',
  'name',
  'lang',
  'layout',
  'released_at',
  'set',
  'set_name',
  'set_type',
  'collector_number',
  'rarity',
  'type_line',
  'cmc',
  'color_identity',
  'mana_cost',
  'oracle_text',
  'keywords',
  'game_changer',
  'full_art',
  'textless',
  'border_color',
  'frame',
  'frame_effects',
  'promo',
  'promo_types',
  'digital',
  'image_status',
  'illustration_id',
] as const satisfies readonly (keyof ScryfallCard)[];

const StoredImageUris = z.object({
  png: z.string().optional(),
  large: z.string().optional(),
  normal: z.string().optional(),
});

const StoredFace = z.object({
  name: z.string(),
  type_line: z.string().optional(),
  mana_cost: z.string().optional(),
  oracle_text: z.string().optional(),
  cmc: z.number().optional(),
  image_uris: StoredImageUris.optional(),
});

/** Loose on purpose: a card gains fields over time, and an old file must still load. */
const StoredCard = z
  .object({
    id: z.string(),
    name: z.string(),
    set: z.string(),
    collector_number: z.string(),
    image_uris: StoredImageUris.optional(),
    card_faces: z.array(StoredFace).optional(),
  })
  .passthrough();

export const DeckDataSchema = z.object({
  version: z.literal(DECK_DATA_VERSION),
  deck: z.string(),
  generatedAt: z.string(),
  /** Fingerprint of the preference profile that chose these printings. */
  profile: z.string(),
  /**
   * Fingerprint of the collection the printings were chosen against, or null
   * when `preferOwned` was off and ownership could not have influenced them.
   */
  owned: z.string().nullable(),
  /** Distinct printings, so a deck running nine copies stores one card. */
  cards: z.array(StoredCard),
  /** Normalised card name -> the id of the printing chosen for it. */
  chosen: z.record(z.string(), z.string()),
});

/**
 * Declared rather than inferred from the schema.
 *
 * A stored card is a Scryfall card with unused fields dropped, so callers should
 * see it as one. The schema's job is to check the shape at runtime, not to
 * describe every field a card can carry.
 */
export interface DeckData {
  version: typeof DECK_DATA_VERSION;
  deck: string;
  generatedAt: string;
  /** Fingerprint of the preference profile that chose these printings. */
  profile: string;
  /** Fingerprint of the collection used, or null when ownership was ignored. */
  owned: string | null;
  cards: ScryfallCard[];
  /** Normalised card name -> the id of the printing chosen for it. */
  chosen: Record<string, string>;
}

export function parseDeckData(data: unknown): DeckData {
  const result = DeckDataSchema.safeParse(data);
  if (result.success) return result.data as unknown as DeckData;
  const lines = result.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`,
  );
  throw new Error(`deck data file is invalid:\n${lines.join('\n')}`);
}
