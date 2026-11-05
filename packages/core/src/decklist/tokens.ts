import type { ScryfallCard } from '../scryfall/types.js';
import { bareSectionHeader, isTokenEntry, parseDecklist } from './parse.js';
import { normalizeName } from '../cards/identity.js';

/**
 * Write a `Tokens` section into a decklist, replacing any section already there.
 *
 * Decklists are files people edit, commit and diff, so this rewrites as little
 * as possible: the rest of the list is returned byte for byte, the file's
 * trailing-newline habit is preserved, and a section that already says the
 * right thing produces no change at all. Headers are recognised through the
 * parser's own rule, so the writer cannot drift from what the reader accepts.
 */
export function setTokensSection(text: string, lines: readonly string[]): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  // Handled separately rather than as a row, so that replacing a section at the
  // end of the file cannot swallow it.
  const trailing = /\r?\n$/.exec(text)?.[0] ?? '';
  const body = trailing ? text.slice(0, text.length - trailing.length) : text;
  const rows = body.split(/\r?\n/);

  // The `Tokens` header, and the extent of the section beneath it: it runs to
  // the next header or to the end of the list.
  let start = -1;
  let end = rows.length;
  for (let index = 0; index < rows.length; index += 1) {
    const section = bareSectionHeader(rows[index] ?? '');
    if (start === -1) {
      if (section === 'tokens') start = index;
      continue;
    }
    if (section !== undefined) {
      end = index;
      break;
    }
  }

  const block = lines.length > 0 ? ['Tokens', ...lines] : [];

  let replaced: string[];
  if (start === -1) {
    if (block.length === 0) return text;
    // Append, keeping exactly one blank line before the new section.
    const head = rows.slice();
    while (head.length > 0 && (head[head.length - 1] ?? '').trim() === '') head.pop();
    replaced = [...head, '', ...block];
  } else {
    const head = rows.slice(0, start);
    // Whatever followed the old section, minus the blank lines that separated
    // it, so a replacement does not accumulate them.
    const tail = rows.slice(end);
    while (tail.length > 0 && (tail[0] ?? '').trim() === '') tail.shift();
    if (block.length === 0) {
      while (head.length > 0 && (head[head.length - 1] ?? '').trim() === '') head.pop();
      replaced = tail.length > 0 ? [...head, '', ...tail] : head;
    } else {
      replaced = tail.length > 0 ? [...head, ...block, '', ...tail] : [...head, ...block];
    }
  }

  const out = replaced.join(newline) + trailing;
  // An unchanged result returns the original string, so callers can skip the write.
  return out === text ? text : out;
}

/** One row of a `Tokens` section: how many, and which token. */
export interface TokenRow {
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
}

/** The rows of a decklist's `Tokens` section, in file order. */
export function readTokenRows(text: string): TokenRow[] {
  return parseDecklist(text)
    .entries.filter(isTokenEntry)
    .map(({ quantity, name, set, collectorNumber }) => ({ quantity, name, set, collectorNumber }));
}

/** A row as the decklist writes it: `4 Wraith (TLTC) 7`. */
export function tokenLine(row: TokenRow): string {
  const printing =
    row.set && row.collectorNumber ? ` (${row.set.toUpperCase()}) ${row.collectorNumber}` : '';
  return `${row.quantity} ${row.name}${printing}`;
}

/**
 * What makes two tokens the same token, whatever printing they come from.
 *
 * The name is not enough: several Wraiths exist and only one is the 3/3 with
 * menace, and a white 1/1 Soldier is not a red one. Art is deliberately left
 * out, so a row repinned to a better printing still counts as that token.
 */
export function tokenIdentity(card: ScryfallCard): string {
  const face = card.card_faces?.[0];
  return [
    card.name,
    card.type_line ?? face?.type_line ?? '',
    card.power ?? face?.power ?? '',
    card.toughness ?? face?.toughness ?? '',
    (card.color_identity ?? []).join(''),
    card.oracle_text ?? face?.oracle_text ?? '',
  ]
    .join('|')
    .toLowerCase();
}

/**
 * Add newly found tokens to a section without disturbing what is there.
 *
 * Rows already in the section keep their place and their quantity, including
 * rows set to 0 and rows the search did not find (a Copy token, say, which no
 * card names in `all_parts`). A found token counts as already listed when a row
 * resolves to the same token, or — for a row with no printing to compare —
 * when the names match.
 *
 * @param rowCards the printing each row names, by index; undefined when unknown.
 */
export function addFoundTokens<T extends { card: ScryfallCard }>(
  rows: readonly TokenRow[],
  rowCards: readonly (ScryfallCard | undefined)[],
  found: readonly T[],
  quantity: number,
): { rows: TokenRow[]; added: T[] } {
  const listed = new Set<string>();
  const listedNames = new Set<string>();
  rows.forEach((row, index) => {
    const card = rowCards[index];
    if (card) listed.add(tokenIdentity(card));
    else listedNames.add(normalizeName(row.name));
  });

  const added = found.filter(
    ({ card }) => !listed.has(tokenIdentity(card)) && !listedNames.has(normalizeName(card.name)),
  );
  return {
    rows: [
      ...rows,
      ...added.map(({ card }) => ({
        quantity,
        name: card.name,
        set: card.set,
        collectorNumber: card.collector_number,
      })),
    ],
    added,
  };
}
