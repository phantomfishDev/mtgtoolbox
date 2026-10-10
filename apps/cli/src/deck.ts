import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  ScryfallClient,
  buildDeckData,
  resolveFromDeckData,
  hasActivePreferences,
  mergeEntries,
  parseDecklist,
  printPlacements,
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
import { FileCardCache, FileImageCache, FilePrintsCache, loadDeckData } from '@mtgproxy/node';
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

export function makeClient(quiet: boolean, rateLimitMs?: number): ScryfallClient {
  return new ScryfallClient({
    ...(rateLimitMs !== undefined ? { rateLimitMs } : {}),
    cardCache: new FileCardCache(),
    printsCache: new FilePrintsCache(),
    imageCache: new FileImageCache(),
    onRequest: quiet ? undefined : (url) => info(dim(`  fetch ${url.replace('https://', '')}`)),
    onRetry: (info) =>
      warn(
        info.reason === 'rate-limit'
          ? `rate-limited by Scryfall; waiting ${Math.round(info.waitMs / 1000)}s (retry ${info.attempt})`
          : `network error (${info.message}); retrying in ${Math.round(info.waitMs / 1000)}s (retry ${info.attempt})`,
      ),
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

export function reportResolve(result: ResolveResult, options: { bothFaces?: boolean } = {}): void {
  for (const warning of result.warnings) {
    // The front-face-only warning is the whole point of --both-faces; repeating
    // it once per card when the backs are being printed is just noise.
    if (options.bothFaces && warning.code === 'double-faced') continue;
    warn(warning.message);
  }
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
  /** Ignore card data stored beside the deck and resolve over the network. */
  ignoreStored?: boolean;
}

export interface LoadedDeck {
  parse: ParseResult;
  resolve: ResolveResult;
  /** True when the slower per-name path was taken. */
  usedPreferences: boolean;
  /** True when the deck came from card data stored beside it. */
  usedStoredData: boolean;
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

  // Card data stored beside the deck makes this a local read rather than one
  // request per distinct card. It is only used when the profile that wrote it
  // still applies; `resolveFromDeckData` refuses otherwise.
  if (!options.ignoreStored && options.profile && path !== '-') {
    const stored = await loadDeckData(path);
    const owned = options.collection ? ownedKeysOf(options.collection) : new Set<string>();
    const applied = stored
      ? resolveFromDeckData(merged, stored, options.profile, owned)
      : null;
    if (applied) {
      info(dim(`  using stored card data (${stored!.cards.length} printings)`));
      return { parse, resolve: applied.result, usedPreferences: false, usedStoredData: true };
    }
  }

  const pins = options.pins ?? {};
  const hasCollection = (options.collection?.cards.length ?? 0) > 0;
  const wantsPreferences =
    (options.profile !== undefined && hasActivePreferences(options.profile, { hasCollection })) ||
    Object.keys(pins).length > 0;

  if (!options.profile || !wantsPreferences) {
    return {
      parse,
      resolve: await resolveDeck(merged, client),
      usedPreferences: false,
      usedStoredData: false,
    };
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

  return { parse, resolve, usedPreferences: true, usedStoredData: false };
}

export { buildDeckData };

/**
 * Download the artwork for each resolved card.
 *
 * Distinct printings are fetched once even when the deck lists several copies;
 * the quantity rides along so the renderer knows how many placements to make.
 * With `bothFaces`, a double-faced card contributes its back as a second image.
 */
export async function fetchImages(
  resolve: ResolveResult,
  client: ScryfallClient,
  quality: ImageQuality,
  bothFaces = false,
): Promise<{ items: PrintItem[]; skipped: string[] }> {
  const { placements, skipped } = printPlacements(resolve.resolved, { quality, bothFaces });

  const items: PrintItem[] = [];
  const progress = new Progress('downloading images', placements.length);
  for (const placement of placements) {
    items.push({
      key: placement.key,
      bytes: await client.image(placement.url, `${placement.key}:${quality}`),
      quantity: placement.quantity,
      name: placement.name,
    });
    progress.tick();
  }
  progress.stop();

  return { items, skipped };
}
