import { commanders, parseDecklist, totalCards, type DeckEntry } from '@mtgproxy/core';

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
  const id = path.split('/').pop()?.replace(/\.txt$/, '') ?? path;
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
