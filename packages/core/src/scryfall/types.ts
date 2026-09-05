/**
 * A narrow view of the Scryfall card object — only the fields this tool uses.
 *
 * Field notes verified against the live API:
 *  - `frame_effects` is absent (undefined) rather than `[]` when a printing has none.
 *  - `full_art` and `border_color === 'borderless'` are independent axes.
 *  - `image_uris` is absent on multi-faced layouts; the faces carry it instead.
 */
export interface ScryfallImageUris {
  small?: string;
  normal?: string;
  large?: string;
  png?: string;
  art_crop?: string;
  border_crop?: string;
}

export interface ScryfallCardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  cmc?: number;
  image_uris?: ScryfallImageUris;
}

export type ImageStatus = 'missing' | 'placeholder' | 'lowres' | 'highres_scan';

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  layout: string;
  released_at: string;
  set: string;
  set_name: string;
  set_type: string;
  collector_number: string;
  rarity: string;
  type_line?: string;
  /** Converted mana cost, for mana-curve analysis. */
  cmc?: number;
  mana_cost?: string;
  /** Scryfall's flag for the Commander "Game Changers" list, used for brackets. */
  game_changer?: boolean;
  keywords?: string[];
  oracle_text?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  full_art: boolean;
  textless?: boolean;
  border_color: string;
  frame: string;
  frame_effects?: string[];
  promo: boolean;
  /** Tags such as `universesbeyond`, `surgefoil`. The only UB signal on the object. */
  promo_types?: string[];
  digital: boolean;
  oversized?: boolean;
  image_status: ImageStatus;
  /** Shared by printings that reuse the same artwork, differing only in frame. */
  illustration_id?: string;
  scryfall_uri?: string;
  games?: string[];
  finishes?: string[];
}

/** An identifier accepted by `POST /cards/collection`. */
export type CardIdentifier =
  | { name: string }
  | { set: string; collector_number: string }
  | { id: string };

export interface CollectionResponse {
  data: ScryfallCard[];
  not_found: CardIdentifier[];
}

/** Image sizes usable for printing, best first. */
export type ImageQuality = 'png' | 'large' | 'normal';

/** Layouts whose back face is a real, separate card face. */
const TWO_FACED_LAYOUTS = new Set([
  'transform',
  'modal_dfc',
  'double_faced_token',
  'reversible_card',
  'art_series',
]);

export function isDoubleFaced(card: ScryfallCard): boolean {
  return TWO_FACED_LAYOUTS.has(card.layout) && (card.card_faces?.length ?? 0) >= 2;
}

/**
 * The front-face image URL at the requested quality, falling back through
 * progressively lower sizes rather than failing outright.
 */
export function frontImageUrl(card: ScryfallCard, quality: ImageQuality): string | null {
  const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  if (!uris) return null;
  const order: ImageQuality[] =
    quality === 'png' ? ['png', 'large', 'normal'] : quality === 'large' ? ['large', 'png', 'normal'] : ['normal', 'large', 'png'];
  for (const key of order) {
    const url = uris[key];
    if (url) return url;
  }
  return null;
}
