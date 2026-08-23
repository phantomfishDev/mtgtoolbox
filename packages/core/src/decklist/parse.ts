/**
 * Decklist parsing.
 *
 * Accepts the paste block produced by the commander-deck-builder skill, plain
 * `<qty> <name>` lists, and Arena/MTGO lines that name a specific printing.
 * A malformed line never aborts the parse: every problem is collected with its
 * line number so the caller can report them all at once.
 */

export interface DeckEntry {
  quantity: number;
  name: string;
  /** Lowercase set code, when the line pinned a printing. */
  set?: string;
  collectorNumber?: string;
  /** 1-based line number in the source text. */
  line: number;
  raw: string;
}

export interface ParseError {
  line: number;
  raw: string;
  message: string;
}

export interface ParseResult {
  entries: DeckEntry[];
  errors: ParseError[];
  /** True when the entries came out of a fenced block in a markdown document. */
  fromMarkdownBlock: boolean;
}

/** Headers that delimit sections rather than naming a card. */
const SECTION_HEADERS = new Set([
  'deck',
  'commander',
  'commanders',
  'sideboard',
  'maybeboard',
  'companion',
  'main',
  'mainboard',
  'tokens',
]);

/**
 * `1 Sol Ring (LTC) 264`, `1x Sol Ring`, `4 Swamp`, `Sol Ring`.
 *
 * The printing suffix is stripped separately so that names containing
 * parentheses survive when no collector number follows them.
 */
const LINE_RE = /^(?:(\d+)\s*[xX]?\s+)?(.*?)\s*$/;
const PRINTING_RE = /\s*\(([A-Za-z0-9]{2,6})\)\s*([A-Za-z0-9★-]+)\s*$/;
/** Arena appends foil/rarity markers such as `*F*`. */
const TRAILING_MARKER_RE = /\s*\*[A-Za-z]\*\s*$/;

function stripComment(line: string): string {
  // `//` is also the double-faced card separator, so only treat it as a comment
  // when it starts the line.
  if (line.trimStart().startsWith('//')) return '';
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
}

/**
 * Pull the decklist out of a markdown document.
 *
 * Prefers a fenced block introduced by a heading that mentions copying or
 * printing — which is what the commander-deck-builder skill emits — and
 * otherwise falls back to the last fence that looks like a decklist.
 */
export function extractFromMarkdown(text: string): string | null {
  const fences = [...text.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm)];
  if (fences.length === 0) return null;

  const headingRe = /copy list|mtgprint|mtgproxy|paste|proxy list|print list/i;
  for (const fence of fences) {
    const before = text.slice(0, fence.index ?? 0);
    const lastHeading = before.match(/^#{1,6} .*$(?![\s\S]*^#{1,6} )/m);
    if (lastHeading && headingRe.test(lastHeading[0])) return fence[1] ?? null;
  }

  // Fall back to the last block whose lines mostly look like `<qty> <name>`.
  for (let i = fences.length - 1; i >= 0; i--) {
    const body = fences[i]?.[1] ?? '';
    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) continue;
    const listy = lines.filter((l) => /^\s*\d+\s*[xX]?\s+\S/.test(l)).length;
    if (listy / lines.length >= 0.8) return body;
  }
  return null;
}

export interface ParseOptions {
  /** Treat the input as markdown and extract its decklist block. Default: auto. */
  markdown?: boolean;
}

export function parseDecklist(text: string, options: ParseOptions = {}): ParseResult {
  let body = text;
  let fromMarkdownBlock = false;

  const looksMarkdown = options.markdown ?? /^[ \t]*```/m.test(text);
  if (looksMarkdown) {
    const block = extractFromMarkdown(text);
    if (block !== null) {
      body = block;
      fromMarkdownBlock = true;
    }
  }

  const entries: DeckEntry[] = [];
  const errors: ParseError[] = [];

  body.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    let working = stripComment(raw).trim();
    if (working === '') return;

    // `Commander: Atraxa` names a card; a bare `Commander` is a section header.
    const labelled = working.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    if (labelled && SECTION_HEADERS.has((labelled[1] ?? '').toLowerCase())) {
      working = labelled[2] ?? '';
    } else if (SECTION_HEADERS.has(working.replace(/[:\s]+$/, '').toLowerCase())) {
      return;
    }

    working = working.replace(TRAILING_MARKER_RE, '');

    let set: string | undefined;
    let collectorNumber: string | undefined;
    const printing = working.match(PRINTING_RE);
    if (printing) {
      set = (printing[1] ?? '').toLowerCase();
      collectorNumber = printing[2];
      working = working.slice(0, printing.index).trim();
    }

    const match = working.match(LINE_RE);
    const name = (match?.[2] ?? '').trim();
    if (name === '') {
      errors.push({ line, raw, message: 'no card name on this line' });
      return;
    }

    const quantity = match?.[1] ? Number.parseInt(match[1], 10) : 1;
    if (!Number.isFinite(quantity) || quantity < 1) {
      errors.push({ line, raw, message: `invalid quantity "${match?.[1]}"` });
      return;
    }

    entries.push({ quantity, name, set, collectorNumber, line, raw });
  });

  return { entries, errors, fromMarkdownBlock };
}

/** Total card count, counting quantities. */
export function totalCards(entries: readonly DeckEntry[]): number {
  return entries.reduce((sum, e) => sum + e.quantity, 0);
}

/** Merge duplicate lines that name the same card and printing. */
export function mergeEntries(entries: readonly DeckEntry[]): DeckEntry[] {
  const byKey = new Map<string, DeckEntry>();
  for (const entry of entries) {
    const key = `${entry.name.toLowerCase()}|${entry.set ?? ''}|${entry.collectorNumber ?? ''}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += entry.quantity;
    else byKey.set(key, { ...entry });
  }
  return [...byKey.values()];
}
