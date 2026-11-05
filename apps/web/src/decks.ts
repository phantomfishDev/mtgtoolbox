import {
  commanders,
  parseDecklist,
  parseDeckData,
  parseDeckIndex,
  parseDeckMeta,
  totalCards,
  type DeckData,
  type DeckEntry,
  type DeckIndex,
} from '@mtgproxy/core';

/**
 * The decklists kept in the repository's `examples/` directory.
 *
 * They are inlined at build time rather than fetched, so the deck list works
 * identically in the static deployment and under `mtgproxy serve` — neither
 * needs a filesystem or an endpoint to read them. Dropping a new `.txt` into
 * that directory is all it takes to have it appear here.
 */
const files = import.meta.glob('../../../examples/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * Stored card data, referenced by URL rather than inlined.
 *
 * A deck's card data is around 60 KB; inlining nine of them would add half a
 * megabyte to the bundle every visitor downloads, for decks most of them will
 * never open. As URLs they are fetched only when a deck is actually used, and
 * come from the same origin, so it is a local read either way.
 */
const dataUrls = import.meta.glob('../../../examples/*.cards.json', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function idFromPath(path: string): string {
  return path.split('/').pop()?.replace(/\.(cards\.json|txt)$/, '') ?? path;
}

const dataUrlById = new Map(
  Object.entries(dataUrls).map(([path, url]) => [idFromPath(path), url]),
);

/**
 * Keyed by deck id, holding the in-flight promise rather than the result.
 *
 * Storing the result would only dedupe *after* a fetch resolved, and callers
 * arrive together — a remount under StrictMode asks twice before either
 * finishes — so the same file would be downloaded several times over.
 */
/**
 * The deck index, fetched once for the list page.
 *
 * Referenced by URL like the per-deck data: it is a single file the list needs
 * up front, but still too large to inline into the bundle.
 */
const indexUrls = import.meta.glob('../../../examples/decks.index.json', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

let indexPromise: Promise<DeckIndex | null> | null = null;

async function fetchIndex(url: string): Promise<DeckIndex> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}`);
  return parseDeckIndex(await response.json());
}

/**
 * The deck index, fetched once and then held until something invalidates it.
 *
 * With a local server it is read from disk through the API first: the copy in
 * the build is a snapshot, and the server rewrites the real one whenever a pin
 * changes a deck's printings. The bundled copy remains the fallback.
 */
export function loadDeckIndex(fromServer = false): Promise<DeckIndex | null> {
  indexPromise ??= (async () => {
    if (fromServer) {
      try {
        return await fetchIndex('/api/index');
      } catch {
        // Fall through to the bundled copy.
      }
    }
    const url = Object.values(indexUrls)[0];
    if (!url) return null;
    try {
      return await fetchIndex(url);
    } catch {
      // The list still works without it, just with less on each card.
      return null;
    }
  })();
  return indexPromise;
}

/** Forget the held index, so the next read sees a deck the server just rewrote. */
export function invalidateDeckIndex(): void {
  indexPromise = null;
}

const dataCache = new Map<string, Promise<DeckData | null>>();

/** Fetch a deck's stored card data, or null when it has none. */
export function loadDeckData(id: string): Promise<DeckData | null> {
  const inFlight = dataCache.get(id);
  if (inFlight) return inFlight;

  const url = dataUrlById.get(id);
  if (!url) {
    const absent = Promise.resolve(null);
    dataCache.set(id, absent);
    return absent;
  }

  const pending = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      return parseDeckData(await response.json());
    } catch {
      // Stored data is an optimisation; a bad file must not break the deck.
      return null;
    }
  })();

  dataCache.set(id, pending);
  return pending;
}

export interface BundledDeck {
  /** Filename without extension, used as a stable identity. */
  id: string;
  name: string;
  text: string;
  cardCount: number;
  commanders: string[];
  /** A leading `#` comment block, when the file opens with one. */
  note: string | null;
  /**
   * Whose deck this is, from a `# Owner:` line in the file.
   *
   * Distinct from the printed counts shown everywhere else: that is about
   * which cards are in the printed ledger, this is about whose deck sits on the
   * shelf and who to hand it to on game night.
   */
  owner: string | null;
  entries: DeckEntry[];
}

/** `food-and-fellowship` -> `Food and Fellowship`. */
export function titleFromId(id: string): string {
  const words = id.split(/[-_]/).filter(Boolean);
  // Short joining words read better lowercase, except as the first word.
  const minor = new Set(['and', 'of', 'the', 'a', 'an', 'for', 'in', 'to']);
  return words
    .map((word, index) =>
      index > 0 && minor.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

function describe(path: string, text: string): BundledDeck {
  const id = idFromPath(path);
  const { entries } = parseDecklist(text);
  const meta = parseDeckMeta(text);
  return {
    id,
    name: meta.name ?? titleFromId(id),
    text,
    entries,
    cardCount: totalCards(entries),
    commanders: commanders(entries).map((entry) => entry.name),
    note: meta.note,
    owner: meta.owner,
  };
}

export const BUNDLED_DECKS: BundledDeck[] = Object.entries(files)
  .map(([path, text]) => describe(path, text))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Bundled deck whose decklist matches this text exactly, if any. */
export function bundledDeckForText(text: string): BundledDeck | undefined {
  return BUNDLED_DECKS.find((deck) => deck.text === text);
}

/**
 * The distinct deck owners, for the list page's filter.
 *
 * Sorted by name so the filter row is stable between builds rather than
 * following whatever order the decks happen to be in.
 */
export const DECK_OWNERS: string[] = [
  ...new Set(BUNDLED_DECKS.map((deck) => deck.owner).filter((o): o is string => o !== null)),
].sort((a, b) => a.localeCompare(b));
