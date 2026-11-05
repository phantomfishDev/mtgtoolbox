import type { GuideStyle, ImageQuality, PaperName, ResolveResult, ScryfallCard, TokenMode } from '@mtgtoolbox/core';

/**
 * The print view's working state.
 *
 * It lives above the view rather than inside it because switching to
 * another tab unmounts the view, and losing a resolved decklist on the way
 * to changing a preference would break the app's main workflow. Transient state —
 * spinners, errors, the open picker — deliberately stays local, since it should
 * not survive a tab switch.
 */
export interface PrintOptions {
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  /** What to do with the list's `Tokens` section. */
  tokens: TokenMode;
  /** Print the back of each double-faced card as a card of its own. */
  bothFaces: boolean;
  gap: number;
}

/**
 * Which printing to use for a card the deck runs more than one of.
 *
 * A deck may want nine copies of one card in nine different artworks, or nine
 * identical ones. `copies` present means the card has been split so each copy
 * chooses for itself; absent means every copy shares `all`.
 */
export interface PrintingChoice {
  all?: ScryfallCard;
  copies?: (ScryfallCard | null)[];
}

export type Overrides = Record<string, PrintingChoice>;

export interface PrintSession {
  text: string;
  /**
   * The bundled deck this list came from, or null for a list typed or pasted in.
   *
   * Carried so that the stored card data beside that deck can still be found
   * once pins have rewritten the text, exactly as in the deck browser. Editing
   * the text clears it: an edited list is no longer that deck.
   */
  deckId: string | null;
  result: ResolveResult | null;
  /** Keyed by normalised card name. */
  overrides: Overrides;
  options: PrintOptions;
}

export const initialSession: PrintSession = {
  text: '',
  deckId: null,
  result: null,
  overrides: {},
  options: {
    paper: 'a4',
    guides: 'crop',
    quality: 'png',
    tokens: 'exclude',
    bothFaces: false,
    gap: 0,
  },
};
