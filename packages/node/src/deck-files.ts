import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseDeckData, type DeckData } from '@mtgproxy/core';

/**
 * Decklists and their stored card data, side by side on disk.
 *
 * A deck is `<name>.txt`; its card data is `<name>.cards.json` beside it. Two
 * files rather than one so the decklist stays something a person can edit in a
 * text editor and paste elsewhere.
 */

export const DECK_DATA_SUFFIX = '.cards.json';

/** Where decklists live: the flag, then the environment, then ./examples. */
export function decksDir(override?: string): string {
  const fromEnv = process.env['MTGPROXY_DECKS'];
  return resolve(override ?? (fromEnv && fromEnv.trim() !== '' ? fromEnv : 'examples'));
}

/** The deck id (filename without extension) for a decklist path. */
export function deckId(path: string): string {
  return basename(path, extname(path));
}

export function deckDataPath(deckPath: string): string {
  return join(dirname(deckPath), `${deckId(deckPath)}${DECK_DATA_SUFFIX}`);
}

/** Every decklist in the directory, sorted, excluding the data sidecars. */
export async function listDecks(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((name) => name.endsWith('.txt') || name.endsWith('.md'))
    .sort()
    .map((name) => join(dir, name));
}

export async function loadDeckData(deckPath: string): Promise<DeckData | null> {
  try {
    return parseDeckData(JSON.parse(await readFile(deckDataPath(deckPath), 'utf8')));
  } catch (error) {
    // Absent or unreadable data is a cache miss, not a failure: the deck still
    // resolves over the network.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

/**
 * Write deck data beside its decklist.
 *
 * Returns false when the file already says exactly this, so a sync that changes
 * nothing leaves the working tree clean rather than churning timestamps.
 */
export async function saveDeckData(deckPath: string, data: DeckData): Promise<boolean> {
  const path = deckDataPath(deckPath);
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  try {
    const existing = await readFile(path, 'utf8');
    // generatedAt differs on every run, so compare everything else.
    const strip = (text: string) => text.replace(/^\s*"generatedAt".*$/m, '');
    if (strip(existing) === strip(serialized)) return false;
  } catch {
    // No existing file; fall through and write.
  }

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, serialized, 'utf8');
  await rename(temporary, path);
  return true;
}

/** Copy a decklist into the decks directory, refusing to clobber. */
export async function adoptDeck(source: string, dir: string): Promise<string> {
  const target = join(dir, `${deckId(source)}.txt`);
  if (resolve(source) === resolve(target)) return target;
  await mkdir(dir, { recursive: true });
  try {
    await copyFile(source, target, 1 /* COPYFILE_EXCL */);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`${target} already exists; rename the file or edit it in place`);
    }
    throw error;
  }
  return target;
}
