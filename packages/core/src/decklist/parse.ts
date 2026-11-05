import { normalizeName } from '../printed/types.js';
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
  /** The section the line appeared under, e.g. `commander`. */
  section?: DeckSection;
  /** 1-based line number in the source text. */
  line: number;
  raw: string;
}

/** Normalised section names. Aliases such as `commanders` fold into one. */
export type DeckSection = 'commander' | 'deck' | 'sideboard' | 'maybeboard' | 'companion' | 'tokens';

/**
 * The section a bare header line names, or undefined if it is not one.
 *
 * Exported so that code which *rewrites* a decklist recognises headers by
 * exactly the rule the parser reads them by. A second copy of this would be
 * free to drift, and a drifted rewriter corrupts the file it is editing.
 */
export function bareSectionHeader(raw: string): DeckSection | undefined {
  const text = raw.replace(/#.*$/, '').trim();
  if (text === '') return undefined;
  return SECTION_HEADERS.get(text.replace(/[:\s]+$/, '').toLowerCase());
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

/**
 * Headers that delimit sections rather than naming a card, mapped to the
 * canonical name so that `Commanders` and `Mainboard` do not become distinct
 * sections from `Commander` and `Deck`.
 */
export const SECTION_HEADERS = new Map<string, DeckSection>([
  ['deck', 'deck'],
  ['main', 'deck'],
  ['mainboard', 'deck'],
  ['commander', 'commander'],
  ['commanders', 'commander'],
  ['sideboard', 'sideboard'],
  ['maybeboard', 'maybeboard'],
  ['companion', 'companion'],
  ['tokens', 'tokens'],
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

/**
 * One card line broken into its parts, or null when the line is not one.
 *
 * Exported so that code which *rewrites* a decklist — pinning a printing —
 * splits lines with exactly the same rules the parser reads them by. A second
 * copy of these regexes would be free to drift, and a drifted rewriter
 * corrupts the file it is editing.
 */
export interface CardLineParts {
  indent: string;
  /** The quantity exactly as written, e.g. `26 ` or `1x `; '' when absent. */
  quantityText: string;
  quantity: number;
  /** The card name as written, with no printing suffix. */
  name: string;
  set?: string;
  collectorNumber?: string;
  /** Whitespace between the card text and any trailing comment. */
  gap: string;
  /** A trailing `# ...` comment, kept so a rewrite does not discard it. */
  comment: string;
}

export function splitCardLine(raw: string): CardLineParts | null {
  const body = stripComment(raw);
  if (body.trim() === '') return null;
  const comment = raw.slice(body.length);

  const indent = body.match(/^\s*/)?.[0] ?? '';
  // Kept so that `1 Forest # note` does not come back as `1 Forest# note`.
  const gap = body.slice(body.trimEnd().length);
  let working = body.trim();

  // Section headers name no card, in either the bare or the labelled form.
  if (SECTION_HEADERS.has(working.replace(/[:\s]+$/, '').toLowerCase())) return null;
  const labelled = working.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
  if (labelled && SECTION_HEADERS.has((labelled[1] ?? '').toLowerCase())) return null;

  working = working.replace(TRAILING_MARKER_RE, '');

  let set: string | undefined;
  let collectorNumber: string | undefined;
  const printing = working.match(PRINTING_RE);
  if (printing) {
    set = (printing[1] ?? '').toLowerCase();
    collectorNumber = printing[2];
    working = working.slice(0, printing.index).trim();
  }

  const match = working.match(/^(?:(\d+)\s*[xX]?\s+)?(.*?)\s*$/);
  const name = (match?.[2] ?? '').trim();
  if (name === '') return null;
  const quantity = match?.[1] ? Number.parseInt(match[1], 10) : 1;
  if (!Number.isFinite(quantity) || quantity < 1) return null;

  // Everything the quantity consumed, so a rewrite reproduces `1x ` as written.
  const quantityText = match?.[1] ? working.slice(0, working.length - name.length) : '';

  return { indent, quantityText, quantity, name, set, collectorNumber, gap, comment };
}

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
  /** Set by a bare header line and applied to every entry beneath it. */
  let currentSection: DeckSection | undefined;

  body.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    let working = stripComment(raw).trim();
    if (working === '') return;

    // `Commander: Atraxa` names a card; a bare `Commander` is a section header.
    let section = currentSection;
    const labelled = working.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    const labelledSection = labelled ? SECTION_HEADERS.get((labelled[1] ?? '').toLowerCase()) : undefined;
    if (labelled && labelledSection) {
      section = labelledSection;
      working = labelled[2] ?? '';
    } else {
      const bare = SECTION_HEADERS.get(working.replace(/[:\s]+$/, '').toLowerCase());
      if (bare) {
        currentSection = bare;
        return;
      }
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
    // A token row may say 0: the deck can make that token, but none are wanted.
    // Keeping the row is what stops the next token search offering it again.
    const least = section === 'tokens' ? 0 : 1;
    if (!Number.isFinite(quantity) || quantity < least) {
      errors.push({ line, raw, message: `invalid quantity "${match?.[1]}"` });
      return;
    }

    entries.push({ quantity, name, set, collectorNumber, section, line, raw });
  });

  // Lists exported by Moxfield and Archidekt put the commander on its own line
  // above the `Deck` header rather than under a `Commander` one. Cards that
  // open such a file are therefore commanders. A file with no headers at all
  // gets no such treatment — there the leading cards are just cards.
  if (entries.some((entry) => entry.section === 'deck')) {
    for (const entry of entries) {
      if (entry.section !== undefined) break;
      entry.section = 'commander';
    }
  }

  return { entries, errors, fromMarkdownBlock };
}

/** The cards listed under a `Commander` header, if the list marked any. */
export function commanders(entries: readonly DeckEntry[]): DeckEntry[] {
  return entries.filter((entry) => entry.section === 'commander');
}

/**
 * A line under a `Tokens` header names a token, not a card in the 99.
 *
 * Tokens are printed from the same sheet machinery as cards, but they are not
 * part of the deck: counting them would make a legal deck read as 112 cards,
 * give every token a mana value of 0 in the curve, and offer them to the
 * bracket check as though they were spells.
 */
export function isTokenEntry(entry: Pick<DeckEntry, 'section'>): boolean {
  return entry.section === 'tokens';
}

/** The complement of `isTokenEntry`: a line that counts towards the deck. */
export function isDeckCard(entry: Pick<DeckEntry, 'section'>): boolean {
  return !isTokenEntry(entry);
}

/**
 * Key for *which printings to look up*: the name, with tokens namespaced.
 *
 * A deck can legitimately run a card and a token of the same name —
 * beorn-bears has the Mutavault land and the Mutavault token,
 * kwain-hare-apparent the Intrepid Rabbit creature and its token — and the two
 * need different queries, so they must not share one lookup. A pin does not
 * change which printings exist, so it is deliberately not part of this key:
 * nine rows of one card pinned to nine arts still cost one fetch.
 */
export function fetchKey(entry: Pick<DeckEntry, 'name' | 'section'>): string {
  const name = normalizeName(entry.name);
  return isTokenEntry(entry) ? `token:${name}` : name;
}

/**
 * Key identifying *one entry's chosen printing*, pin included.
 *
 * Distinct from `fetchKey` because a name is not unique within a deck once
 * printings are pinned: beorn-bears lists two different Bear tokens, rats two
 * different 1/1 Rats, prismari-artistry four different Elementals, and a deck
 * may run nine copies of one card each pinned to its own art. Keyed by name
 * alone, those rows collapse into one stored choice and the rest inherit a
 * printing they did not ask for.
 */
export function choiceKey(
  entry: Pick<DeckEntry, 'name' | 'section' | 'set' | 'collectorNumber'>,
): string {
  const base = fetchKey(entry);
  if (!entry.set || !entry.collectorNumber) return base;
  return `${base}|${entry.set.toLowerCase()}|${entry.collectorNumber.toLowerCase()}`;
}

/** What a command should do with a decklist's `Tokens` section. */
export type TokenMode = 'exclude' | 'include' | 'only';

export const TOKEN_MODES: readonly TokenMode[] = ['exclude', 'include', 'only'];

/**
 * Narrow a parsed list to what a token mode asks for.
 *
 * `exclude` is the default everywhere, so adding a `Tokens` section to a deck
 * cannot change what an existing command prints. Token rows set to 0 are
 * dropped in every mode: they record a choice not to print, not a card.
 */
export function selectForTokenMode(
  entries: readonly DeckEntry[],
  mode: TokenMode = 'exclude',
): DeckEntry[] {
  const wanted = entries.filter((entry) => entry.quantity > 0);
  if (mode === 'include') return wanted;
  if (mode === 'only') return wanted.filter(isTokenEntry);
  return wanted.filter(isDeckCard);
}

/** Total card count, counting quantities. Tokens are not cards. */
export function totalCards(entries: readonly DeckEntry[]): number {
  return entries.filter(isDeckCard).reduce((sum, e) => sum + e.quantity, 0);
}

/** Total tokens listed, counting quantities. */
export function totalTokens(entries: readonly DeckEntry[]): number {
  return entries.filter(isTokenEntry).reduce((sum, e) => sum + e.quantity, 0);
}

/** Merge duplicate lines that name the same card and printing. */
export function mergeEntries(entries: readonly DeckEntry[]): DeckEntry[] {
  const byKey = new Map<string, DeckEntry>();
  for (const entry of entries) {
    const key = `${entry.name.toLowerCase()}|${entry.set ?? ''}|${entry.collectorNumber ?? ''}|${entry.section ?? ''}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += entry.quantity;
    else byKey.set(key, { ...entry });
  }
  return [...byKey.values()];
}
