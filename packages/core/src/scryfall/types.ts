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
  /** Printed power and toughness, as strings: they can be `*` or `1+*`. */
  power?: string;
  toughness?: string;
  type_line?: string;
  oracle_text?: string;
  cmc?: number;
  image_uris?: ScryfallImageUris;
}

export type ImageStatus = 'missing' | 'placeholder' | 'lowres' | 'highres_scan';

/** An entry in `all_parts`: another card this one is related to. */
export interface ScryfallRelatedCard {
  id: string;
  object: string;
  /** `token`, `combo_piece`, `meld_part`, `meld_result`. */
  component: string;
  name: string;
  type_line: string;
  uri: string;
}

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
  /** WUBRG letters; a Commander deck's colours are its commander's identity. */
  color_identity?: string[];
  mana_cost?: string;
  /** Printed power and toughness, as strings: they can be `*` or `1+*`. */
  power?: string;
  toughness?: string;
  /** Scryfall's flag for the Commander "Game Changers" list, used for brackets. */
  game_changer?: boolean;
  /**
   * Related cards: the tokens a card makes, meld halves, combo pieces.
   *
   * This is how token discovery works without a hardcoded table — a card that
   * makes a token names it here, with an id for the exact printing.
   */
  all_parts?: ScryfallRelatedCard[];
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

/** Layouts that are a token rather than a card. */
const TOKEN_LAYOUTS = new Set(['token', 'double_faced_token']);

/**
 * A token printing, told apart by layout rather than by set type.
 *
 * `set_type === 'token'` is close but not the same thing: some tokens ship in
 * ordinary sets, and some token-set products contain non-token filler.
 */
export function isTokenCard(card: ScryfallCard): boolean {
  return TOKEN_LAYOUTS.has(card.layout);
}

/**
 * The tokens a card makes, from `all_parts`.
 *
 * Deliberately returns the related-card stubs rather than full cards: the stub
 * carries the id, so the caller decides whether to spend a request fetching
 * the printing.
 */
export function tokenParts(card: ScryfallCard): ScryfallRelatedCard[] {
  return (card.all_parts ?? []).filter((part) => part.component === 'token');
}

/** Which side of a card to print. */
export type CardFaceSide = 'front' | 'back';

function pickSize(uris: ScryfallImageUris | undefined, quality: ImageQuality): string | null {
  if (!uris) return null;
  const order: ImageQuality[] =
    quality === 'png' ? ['png', 'large', 'normal'] : quality === 'large' ? ['large', 'png', 'normal'] : ['normal', 'large', 'png'];
  for (const key of order) {
    const url = uris[key];
    if (url) return url;
  }
  return null;
}

/**
 * One face's image URL at the requested quality, falling back through
 * progressively lower sizes rather than failing outright.
 *
 * A single-faced card carries `image_uris` itself; a two-faced one carries
 * nothing at the top level and one set per face. Asking a single-faced card for
 * its back is not an error — there simply isn't one, so this returns null and
 * the caller prints the front alone.
 */
export function faceImageUrl(
  card: ScryfallCard,
  quality: ImageQuality,
  side: CardFaceSide = 'front',
): string | null {
  if (side === 'back') {
    if (!isDoubleFaced(card)) return null;
    return pickSize(card.card_faces?.[1]?.image_uris, quality);
  }
  return pickSize(card.image_uris ?? card.card_faces?.[0]?.image_uris, quality);
}

/** The front-face image URL at the requested quality. */
export function frontImageUrl(card: ScryfallCard, quality: ImageQuality): string | null {
  return faceImageUrl(card, quality, 'front');
}

/** The back-face image URL, or null for a card that has only one face. */
export function backImageUrl(card: ScryfallCard, quality: ImageQuality): string | null {
  return faceImageUrl(card, quality, 'back');
}
