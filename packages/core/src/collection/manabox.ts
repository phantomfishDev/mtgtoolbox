import { indexHeaders, parseCsv, toCsv } from './csv.js';
import { addEntry } from './collection.js';
import {
  DEFAULT_LANGUAGE,
  emptyCollection,
  entryLanguage,
  sortEntries,
  type Collection,
  type CollectionEntry,
  type Finish,
} from './types.js';

/**
 * Moving a collection in and out of ManaBox.
 *
 * ManaBox is a scanning app: the phone reads a stack of cards and exports a CSV
 * of exactly which printings you own. That is the same fact this tool's
 * collection file records, so the two should interchange freely rather than
 * making anyone re-enter a shelf of cards by hand.
 *
 * The reader is deliberately lenient about the shape of the file and strict
 * about the shape of an entry: columns are matched by name in any order, and a
 * row that cannot become a valid entry is reported rather than guessed at.
 */

/** ManaBox's own export header, in its own order. */
export const MANABOX_COLUMNS = [
  'Name',
  'Set code',
  'Set name',
  'Collector number',
  'Foil',
  'Rarity',
  'Quantity',
  'ManaBox ID',
  'Scryfall ID',
  'Purchase price',
  'Misprint',
  'Altered',
  'Condition',
  'Language',
  'Purchase price currency',
] as const;

/**
 * Column aliases, folded by `headerKey`.
 *
 * ManaBox's own headings come first; the rest let a file that has been through
 * a spreadsheet, or come from a neighbouring tracker, still land correctly.
 */
const ALIASES: Record<string, readonly string[]> = {
  name: ['name', 'cardname', 'card'],
  set: ['setcode', 'set', 'edition', 'setid'],
  collectorNumber: ['collectornumber', 'cardnumber', 'number', 'cn'],
  finish: ['foil', 'finish', 'printing', 'foiling'],
  quantity: ['quantity', 'qty', 'count', 'amount'],
  scryfallId: ['scryfallid', 'scryfall'],
  language: ['language', 'lang'],
  binder: ['bindername', 'binder', 'listname', 'list'],
};

const FINISHES_BY_LABEL: Record<string, Finish> = {
  '': 'nonfoil',
  normal: 'nonfoil',
  nonfoil: 'nonfoil',
  none: 'nonfoil',
  no: 'nonfoil',
  false: 'nonfoil',
  foil: 'foil',
  yes: 'foil',
  true: 'foil',
  etched: 'etched',
  foiletched: 'etched',
  etchedfoil: 'etched',
};

/** Enough language names to cover the spellings a hand-edited file might use. */
const LANGUAGES_BY_NAME: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  japanese: 'ja',
  korean: 'ko',
  russian: 'ru',
  chinesesimplified: 'zhs',
  chinesetraditional: 'zht',
};

/** A row that could not be turned into an entry, and why. */
export interface SkippedRow {
  /** 1-based line number in the source file, for pointing at the offending row. */
  line: number;
  reason: string;
  /** Whatever the row called the card, when it named one at all. */
  name?: string;
}

export interface ManaboxImport {
  entries: CollectionEntry[];
  /** Data rows read, excluding the header. */
  rows: number;
  skipped: SkippedRow[];
}

export interface ManaboxImportOptions {
  /**
   * Record each card's ManaBox binder or list as a tag, so the grouping you set
   * up on the phone survives the trip. Default: true.
   */
  tagBinders?: boolean;
}

/**
 * Read a ManaBox CSV export into collection entries.
 *
 * Entries come back unmerged and in file order; `mergeIntoCollection` folds them
 * into a collection.
 */
export function parseManaboxCsv(text: string, options: ManaboxImportOptions = {}): ManaboxImport {
  const tagBinders = options.tagBinders ?? true;
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) throw new Error('the CSV file is empty');

  const columns = indexHeaders(header);
  const columnFor = (field: keyof typeof ALIASES): number | undefined => {
    for (const alias of ALIASES[field]!) {
      const index = columns.get(alias);
      if (index !== undefined) return index;
    }
    return undefined;
  };

  const at = {
    name: columnFor('name'),
    set: columnFor('set'),
    collectorNumber: columnFor('collectorNumber'),
    finish: columnFor('finish'),
    quantity: columnFor('quantity'),
    scryfallId: columnFor('scryfallId'),
    language: columnFor('language'),
    binder: columnFor('binder'),
  };

  // Without these three there is nothing to identify a printing by, and every
  // row would be skipped for the same reason — better to say so once, up front.
  const required = { name: 'Name', set: 'Set code', collectorNumber: 'Collector number' } as const;
  const missing = Object.keys(required).filter(
    (key) => at[key as keyof typeof required] === undefined,
  );
  if (missing.length > 0) {
    const wanted = missing.map((key) => `"${required[key as keyof typeof required]}"`).join(' or ');
    throw new Error(
      `this does not look like a ManaBox export: no ${wanted} column ` +
        `(found: ${header.filter(Boolean).join(', ')})`,
    );
  }

  const cell = (row: readonly string[], index: number | undefined): string =>
    (index === undefined ? '' : (row[index] ?? '')).trim();

  const entries: CollectionEntry[] = [];
  const skipped: SkippedRow[] = [];

  rows.slice(1).forEach((row, offset) => {
    const line = offset + 2;
    const name = cell(row, at.name);
    const set = cell(row, at.set).toLowerCase();
    const collectorNumber = cell(row, at.collectorNumber);
    const skip = (reason: string): void => {
      skipped.push({ line, reason, ...(name ? { name } : {}) });
    };

    if (!name) return skip('no card name');
    if (!set) return skip('no set code');
    if (!collectorNumber) return skip('no collector number');

    const rawQuantity = cell(row, at.quantity);
    const quantity = rawQuantity === '' ? 1 : Number.parseInt(rawQuantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return skip(`quantity "${rawQuantity}" is not a positive whole number`);
    }

    const rawFinish = cell(row, at.finish);
    const finish = FINISHES_BY_LABEL[rawFinish.toLowerCase().replace(/[^a-z]/g, '')];
    if (finish === undefined) return skip(`unrecognised finish "${rawFinish}"`);

    const language = readLanguage(cell(row, at.language));
    const binder = cell(row, at.binder);
    const scryfallId = cell(row, at.scryfallId);

    entries.push({
      name,
      set,
      collectorNumber,
      finish,
      quantity,
      ...(language ? { language } : {}),
      ...(scryfallId ? { scryfallId } : {}),
      ...(tagBinders && binder ? { tags: [binder] } : {}),
    });
  });

  return { entries, rows: Math.max(rows.length - 1, 0), skipped };
}

function readLanguage(value: string): string | undefined {
  if (!value) return undefined;
  const folded = value.toLowerCase().replace(/[^a-z]/g, '');
  const code = LANGUAGES_BY_NAME[folded] ?? value.toLowerCase();
  return code === DEFAULT_LANGUAGE ? undefined : code;
}

export interface MergeOptions {
  /**
   * `merge` adds the imported copies to what is already held; `replace` throws
   * the existing collection away first. Default: `merge`.
   */
  mode?: 'merge' | 'replace';
}

/**
 * Fold imported entries into a collection.
 *
 * Merging goes through `addEntry`, so repeated printings — whether repeated
 * within the file or already owned — combine into one entry rather than
 * accumulating duplicate rows.
 */
export function mergeIntoCollection(
  collection: Collection,
  entries: readonly CollectionEntry[],
  options: MergeOptions = {},
): Collection {
  let next = options.mode === 'replace' ? emptyCollection() : collection;
  for (const entry of entries) next = addEntry(next, entry);
  return next;
}

/** Read a ManaBox CSV and apply it to a collection in one step. */
export function importManaboxCsv(
  collection: Collection,
  text: string,
  options: ManaboxImportOptions & MergeOptions = {},
): { collection: Collection; result: ManaboxImport } {
  const result = parseManaboxCsv(text, options);
  return { collection: mergeIntoCollection(collection, result.entries, options), result };
}

/**
 * Write a collection as a ManaBox CSV export.
 *
 * Every column ManaBox exports is emitted so the file is recognisable to it and
 * to the other trackers that read this format, but the ones this tool does not
 * track are left blank rather than filled with plausible-looking defaults:
 * condition, price and grading are not its business, and inventing `near_mint`
 * for a card it has never seen would be a lie the app would happily believe. A
 * blank optional column reads as "not stated"; name, set code and collector
 * number are what ManaBox actually matches on, and those are always present.
 */
export function toManaboxCsv(collection: Collection): string {
  const rows: string[][] = [[...MANABOX_COLUMNS]];
  for (const entry of sortEntries(collection.cards)) {
    rows.push([
      entry.name,
      entry.set.toUpperCase(),
      '', // Set name: not stored; the set code identifies the printing.
      entry.collectorNumber,
      entry.finish === 'nonfoil' ? 'normal' : entry.finish,
      '', // Rarity.
      String(entry.quantity),
      '', // ManaBox ID: internal to the app.
      entry.scryfallId ?? '',
      '', // Purchase price.
      '', // Misprint.
      '', // Altered.
      '', // Condition.
      entryLanguage(entry),
      '', // Purchase price currency.
    ]);
  }
  return toCsv(rows);
}
