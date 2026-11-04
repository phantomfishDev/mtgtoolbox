import type { GuideStyle, ImageQuality, PaperName, ResolveResult, ScryfallCard, TokenMode } from '@mtgproxy/core';

/**
 * The print view's working state.
 *
 * It lives above the view rather than inside it because switching to the
 * printed tab unmounts the view, and losing a resolved decklist on the way
 * to adding one card would break the app's main workflow. Transient state —
 * spinners, errors, the open picker — deliberately stays local, since it should
 * not survive a tab switch.
 */
export interface PrintOptions {
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  unprinted: boolean;
  /** What to do with the list's `Tokens` section. */
  tokens: TokenMode;
  assumeBasics: boolean;
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
  result: ResolveResult | null;
  /** Keyed by normalised card name. */
  overrides: Overrides;
  options: PrintOptions;
}

export const initialSession: PrintSession = {
  text: '',
  result: null,
  overrides: {},
  options: {
    paper: 'a4',
    guides: 'crop',
    quality: 'png',
    unprinted: false,
    tokens: 'exclude',
    assumeBasics: false,
    bothFaces: false,
    gap: 0,
  },
};
