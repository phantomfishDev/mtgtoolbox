/**
 * Links to a single deck: `<site>#/deck/<id>`.
 *
 * The route lives in the URL fragment because the published shelf is a static
 * site on a GitHub Pages subpath: a real path such as `/deck/nazgul` would be a
 * 404 there, while a fragment never reaches the server, so the same link works
 * on Pages, under `mtgtoolbox serve` and from `vite dev` alike.
 *
 * The id is the decklist's filename, not its display name, so a link keeps
 * working when a deck is renamed.
 */

const DECK_ROUTE = /^#\/?deck\/([^/?#]+)\/?$/;

/** The deck id a fragment points at, or null for anything else. */
export function deckIdFromHash(hash: string): string | null {
  const match = DECK_ROUTE.exec(hash);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function hashForDeck(id: string): string {
  return `#/deck/${encodeURIComponent(id)}`;
}

/** The full, shareable address of one deck on this site. */
export function deckUrl(id: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${hashForDeck(id)}`;
}

/**
 * Point the address bar at a deck, or back at the shelf with null.
 *
 * Pushes a history entry, so the browser's Back button returns to wherever the
 * visitor was. Does nothing when the address already says this.
 */
export function navigateToDeck(id: string | null): void {
  const target = id === null ? '' : hashForDeck(id);
  if (window.location.hash === target) return;
  const { pathname, search } = window.location;
  window.history.pushState(null, '', `${pathname}${search}${target}`);
}
