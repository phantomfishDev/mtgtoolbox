import { z } from 'zod';

/**
 * The printed ledger.
 *
 * A record of which printings you have already run off, so a print job can skip
 * them. This is the one artefact in the tool that a user cannot regenerate, so
 * it is validated strictly on read, versioned, and written back in a stable
 * order so that it stays readable and diffable under version control.
 *
 * `finish` records the stock a printing was run on, so the same card printed
 * again on different stock is a separate entry rather than a duplicate.
 */

export const FINISHES = ['nonfoil', 'foil', 'etched'] as const;
export type Finish = (typeof FINISHES)[number];

export const PrintedEntrySchema = z.object({
  name: z.string().min(1),
  set: z.string().min(1).toLowerCase(),
  collectorNumber: z.string().min(1),
  finish: z.enum(FINISHES).default('nonfoil'),
  quantity: z.number().int().positive(),
  /** Scryfall language code. Absent means English, which is the common case. */
  language: z.string().min(1).toLowerCase().optional(),
  scryfallId: z.string().optional(),
  addedAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
});

export type PrintedEntry = z.infer<typeof PrintedEntrySchema>;

export const PRINTED_VERSION = 1;

export const PrintedSchema = z.object({
  version: z.literal(PRINTED_VERSION),
  updatedAt: z.string().optional(),
  cards: z.array(PrintedEntrySchema),
});

export type PrintedLedger = z.infer<typeof PrintedSchema>;

export function emptyLedger(): PrintedLedger {
  return { version: PRINTED_VERSION, updatedAt: new Date().toISOString(), cards: [] };
}

/**
 * Parse and validate the ledger, turning zod's issue list into a message that
 * names the offending entry rather than just its array index.
 */
export function parsePrinted(data: unknown): PrintedLedger {
  const result = PrintedSchema.safeParse(data);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    const index = typeof issue.path[1] === 'number' ? issue.path[1] : undefined;
    const entry =
      index !== undefined && Array.isArray((data as PrintedLedger)?.cards)
        ? (data as PrintedLedger).cards[index]
        : undefined;
    const label = entry ? ` (${entry.name ?? 'unnamed'})` : '';
    return `  ${path || '<root>'}${label}: ${issue.message}`;
  });
  throw new Error(`printed ledger file is invalid:\n${lines.join('\n')}`);
}

export const DEFAULT_LANGUAGE = 'en';

/** The language an entry is in, with the English default made explicit. */
export function entryLanguage(entry: Pick<PrintedEntry, 'language'>): string {
  return entry.language?.toLowerCase() || DEFAULT_LANGUAGE;
}

/**
 * Identity of a specific printing in a specific finish and language.
 *
 * A Japanese copy shares its set and collector number with the English one but
 * is a different physical card, and Scryfall treats it as a different printing,
 * so the language belongs in the key.
 */
export function entryKey(
  entry: Pick<PrintedEntry, 'name' | 'set' | 'collectorNumber' | 'finish' | 'language'>,
): string {
  return [
    normalizeName(entry.name),
    entry.set.toLowerCase(),
    entry.collectorNumber.toLowerCase(),
    entry.finish,
    entryLanguage(entry),
  ].join('|');
}

/**
 * Normalise a card name for matching.
 *
 * Case and surrounding whitespace are insignificant, and the curly apostrophe
 * Scryfall uses in names like "Praetors' Voice" is folded to a straight one so
 * that hand-typed lists match.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/’/g, "'");
}

/** The front-face name of a double-faced card, for matching lists that omit the back. */
export function frontName(name: string): string {
  const index = name.indexOf('//');
  return index === -1 ? normalizeName(name) : normalizeName(name.slice(0, index));
}

/** Sort entries into a stable, human-scannable order. */
export function sortEntries(entries: readonly PrintedEntry[]): PrintedEntry[] {
  return [...entries].sort(
    (a, b) =>
      normalizeName(a.name).localeCompare(normalizeName(b.name)) ||
      a.set.localeCompare(b.set) ||
      compareCollectorNumbers(a.collectorNumber, b.collectorNumber) ||
      a.finish.localeCompare(b.finish) ||
      entryLanguage(a).localeCompare(entryLanguage(b)),
  );
}

/**
 * Compare collector numbers so that "10" sorts after "9".
 *
 * Numbers can carry letter suffixes ("123a") and stars ("★"), so the numeric
 * prefix is compared first and the remainder breaks ties.
 */
export function compareCollectorNumbers(a: string, b: string): number {
  const parse = (value: string): [number, string] => {
    const match = value.match(/^(\d+)(.*)$/);
    return match ? [Number.parseInt(match[1]!, 10), match[2] ?? ''] : [Number.POSITIVE_INFINITY, value];
  };
  const [numberA, restA] = parse(a);
  const [numberB, restB] = parse(b);
  return numberA - numberB || restA.localeCompare(restB);
}
