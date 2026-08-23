import type {
  GuideStyle,
  ImageQuality,
  PaperName,
  ResolveResult,
  ScryfallCard,
} from '@mtgproxy/core';

/**
 * The print view's working state.
 *
 * It lives above the view rather than inside it because switching to the
 * collection tab unmounts the view, and losing a resolved decklist on the way
 * to adding one card would break the app's main workflow. Transient state —
 * spinners, errors, the open picker — deliberately stays local, since it should
 * not survive a tab switch.
 */
export interface PrintOptions {
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  missingOnly: boolean;
  assumeBasics: boolean;
  gap: number;
}

export interface PrintSession {
  text: string;
  result: ResolveResult | null;
  /** Manual printing choices, keyed by normalised card name. */
  overrides: Record<string, ScryfallCard>;
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
    missingOnly: false,
    assumeBasics: true,
    gap: 0,
  },
};
