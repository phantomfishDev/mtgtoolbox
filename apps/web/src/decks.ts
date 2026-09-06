import {
  commanders,
  parseDecklist,
  parseDeckData,
  parseDeckIndex,
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

export function loadDeckIndex(): Promise<DeckIndex | null> {
  indexPromise ??= (async () => {
    const url = Object.values(indexUrls)[0];
    if (!url) return null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      return parseDeckIndex(await response.json());
    } catch {
      // The list still works without it, just with less on each card.
      return null;
    }
  })();
  return indexPromise;
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
  entries: DeckEntry[];
}

/** `food-and-fellowship` -> `Food and Fellowship`. */
function titleFromId(id: string): string {
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

/** The opening comment block, which is where these files explain themselves. */
function leadingNote(text: string): string | null {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (lines.length > 0) break;
      continue;
    }
    if (!trimmed.startsWith('#')) break;
    lines.push(trimmed.replace(/^#\s?/, ''));
  }
  const note = lines.join(' ').trim();
  return note === '' ? null : note;
}

function describe(path: string, text: string): BundledDeck {
  const id = idFromPath(path);
  const { entries } = parseDecklist(text);
  return {
    id,
    name: titleFromId(id),
    text,
    entries,
    cardCount: totalCards(entries),
    commanders: commanders(entries).map((entry) => entry.name),
    note: leadingNote(text),
  };
}

export const BUNDLED_DECKS: BundledDeck[] = Object.entries(files)
  .map(([path, text]) => describe(path, text))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Bundled deck whose decklist matches this text exactly, if any. */
export function bundledDeckForText(text: string): BundledDeck | undefined {
  return BUNDLED_DECKS.find((deck) => deck.text === text);
}
