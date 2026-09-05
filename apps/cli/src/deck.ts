import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  ScryfallClient,
  frontImageUrl,
  hasActivePreferences,
  mergeEntries,
  parseDecklist,
  resolveDeck,
  resolveDeckWithPreferences,
  totalCards,
  type Collection,
  type ImageQuality,
  type ParseResult,
  type PreferenceProfile,
  type ResolveResult,
} from '@mtgproxy/core';
import type { PrintItem } from '@mtgproxy/core/pdf';
import { FileCardCache, FileImageCache, FilePrintsCache } from '@mtgproxy/node';
import { Progress, dim, fail, info, warn, yellow } from './ui.js';

/** Read a decklist from a file path, or from stdin when the path is `-`. */
export async function readDeckSource(path: string): Promise<{ text: string; markdown: boolean }> {
  if (path === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    // Stdin has no extension to go on, so fall back to sniffing for a fence.
    return { text, markdown: /^[ \t]*```/m.test(text) };
  }
  const text = await readFile(path, 'utf8');
  return { text, markdown: ['.md', '.markdown'].includes(extname(path).toLowerCase()) };
}

export function makeClient(quiet: boolean): ScryfallClient {
  return new ScryfallClient({
    cardCache: new FileCardCache(),
    printsCache: new FilePrintsCache(),
    imageCache: new FileImageCache(),
    onRequest: quiet ? undefined : (url) => info(dim(`  fetch ${url.replace('https://', '')}`)),
    onRateLimit: (waitMs, attempt) =>
      warn(`rate-limited by Scryfall; waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt})`),
  });
}

/** Every key a collection entry can be recognised by, for `preferOwned`. */
export function ownedKeysOf(collection: Collection): Set<string> {
  const keys = new Set<string>();
  for (const entry of collection.cards) {
    if (entry.scryfallId) keys.add(entry.scryfallId);
    keys.add(`${entry.set.toLowerCase()}|${entry.collectorNumber.toLowerCase()}`);
  }
  return keys;
}

export function reportParse(result: ParseResult, path: string): void {
  const count = totalCards(result.entries);
  const source = result.fromMarkdownBlock ? ' (from markdown block)' : '';
  info(`Parsed ${result.entries.length} lines, ${count} cards from ${path}${source}`);
  for (const error of result.errors) {
    warn(`line ${error.line}: ${error.message} ${dim(`-- ${error.raw.trim()}`)}`);
  }
  // Commander decks are exactly 100; anything else is worth a nudge, not an error.
  if (count !== 100 && count > 0) {
    info(dim(`  note: ${count} cards (a Commander deck is 100)`));
  }
}

export function reportResolve(result: ResolveResult): void {
  for (const warning of result.warnings) warn(warning.message);
  for (const item of result.unresolved) fail(`line ${item.entry.line}: ${item.reason}`);
  if (result.unresolved.length > 0) {
    info(yellow(`${result.unresolved.length} card(s) could not be resolved and will be skipped`));
  }
}

export interface LoadDeckOptions {
  markdown?: boolean;
  profile?: PreferenceProfile;
  collection?: Collection;
  pins?: Record<string, { set: string; collectorNumber: string }>;
}

export interface LoadedDeck {
  parse: ParseResult;
  resolve: ResolveResult;
  /** True when the slower per-name path was taken. */
  usedPreferences: boolean;
}

/**
 * Parse and resolve a decklist.
 *
 * Picks the cheap batch path (two requests per deck) unless the profile
 * actually expresses a preference, in which case every printing of every
 * distinct name has to be fetched so the engine has something to rank.
 */
export async function loadDeck(
  path: string,
  client: ScryfallClient,
  options: LoadDeckOptions = {},
): Promise<LoadedDeck> {
  const source = await readDeckSource(path);
  const parse = parseDecklist(source.text, { markdown: options.markdown ?? source.markdown });
  reportParse(parse, path === '-' ? 'stdin' : path);
  if (parse.entries.length === 0) throw new Error('no cards found in the decklist');

  const merged = mergeEntries(parse.entries);
  const pins = options.pins ?? {};
  const hasCollection = (options.collection?.cards.length ?? 0) > 0;
  const wantsPreferences =
    (options.profile !== undefined && hasActivePreferences(options.profile, { hasCollection })) ||
    Object.keys(pins).length > 0;

  if (!options.profile || !wantsPreferences) {
    return { parse, resolve: await resolveDeck(merged, client), usedPreferences: false };
  }

  const distinct = new Set(merged.map((entry) => entry.name.toLowerCase())).size;
  info(dim(`  ranking printings for ${distinct} distinct cards`));
  const progress = new Progress('fetching printings', distinct);

  const resolve = await resolveDeckWithPreferences(merged, client, {
    profile: options.profile,
    ...(options.collection ? { ownedKeys: ownedKeysOf(options.collection) } : {}),
    pins,
    onProgress: (done) => progress.set(done),
  });
  progress.stop();

  return { parse, resolve, usedPreferences: true };
}

/**
 * Download the artwork for each resolved card.
 *
 * Distinct printings are fetched once even when the deck lists several copies;
 * the quantity rides along so the renderer knows how many placements to make.
 */
export async function fetchImages(
  resolve: ResolveResult,
  client: ScryfallClient,
  quality: ImageQuality,
): Promise<{ items: PrintItem[]; skipped: string[] }> {
  const byPrinting = new Map<string, PrintItem & { url: string }>();
  const skipped: string[] = [];

  for (const item of resolve.resolved) {
    const existing = byPrinting.get(item.card.id);
    if (existing) {
      existing.quantity += item.entry.quantity;
      continue;
    }
    const url = frontImageUrl(item.card, quality);
    if (!url) {
      skipped.push(`${item.card.name} (${item.card.set.toUpperCase()}) has no printable image`);
      continue;
    }
    byPrinting.set(item.card.id, {
      key: item.card.id,
      url,
      bytes: new Uint8Array(),
      quantity: item.entry.quantity,
      name: item.card.name,
    });
  }

  const pending = [...byPrinting.values()];
  const progress = new Progress('downloading images', pending.length);
  for (const item of pending) {
    item.bytes = await client.image(item.url, `${item.key}:${quality}`);
    progress.tick();
  }
  progress.stop();

  return {
    items: pending.map(({ key, bytes, quantity, name }) => ({ key, bytes, quantity, name })),
    skipped,
  };
}
