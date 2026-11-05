/**
 * Showcase mode: the build published for other people to look at.
 *
 * The app has always run in two situations — a static site and `mtgtoolbox
 * serve` — but both of those assume the person using it is the one who owns
 * the decks. A site shared with friends is a third: they are here to see what
 * is on the shelf, not to edit it.
 *
 * So this mode is strictly read-only. It is not a cosmetic difference: there
 * are no preferences to change, no printing to
 * pin, and nothing anywhere that writes. The store it runs on cannot write at
 * all, which is what makes that a guarantee rather than an intention.
 *
 * Set at build time, because what is published should not depend on anything
 * the visitor's browser happens to say:
 *
 * ```bash
 * pnpm --filter @mtgtoolbox/web build:showcase
 * ```
 */
export const SHOWCASE = import.meta.env.VITE_SHOWCASE === '1';

/**
 * What the page calls itself.
 *
 * The project's own name describes how it is built rather than what is being
 * shared, and it is the wrong banner for a page handed to a friend. Override
 * it with `VITE_SHOWCASE_TITLE` when publishing.
 */
export const APP_TITLE = SHOWCASE
  ? (import.meta.env.VITE_SHOWCASE_TITLE ?? '').trim() || 'The Deck Shelf'
  : 'mtgtoolbox';
