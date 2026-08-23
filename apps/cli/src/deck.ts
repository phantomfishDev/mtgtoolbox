import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  ScryfallClient,
  frontImageUrl,
  mergeEntries,
  parseDecklist,
  resolveDeck,
  totalCards,
  type ImageQuality,
  type ParseResult,
  type PrintItem,
  type ResolveResult,
} from '@mtgproxy/core';
import { FileCardCache, FileImageCache } from '@mtgproxy/node';
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
    imageCache: new FileImageCache(),
    onRequest: quiet ? undefined : (url) => info(dim(`  fetch ${url.replace('https://', '')}`)),
  });
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
  for (const item of result.unresolved) {
    fail(`line ${item.entry.line}: ${item.reason}`);
  }
  if (result.unresolved.length > 0) {
    info(yellow(`${result.unresolved.length} card(s) could not be resolved and will be skipped`));
  }
}

export interface LoadedDeck {
  parse: ParseResult;
  resolve: ResolveResult;
}

export async function loadDeck(
  path: string,
  client: ScryfallClient,
  options: { markdown?: boolean } = {},
): Promise<LoadedDeck> {
  const source = await readDeckSource(path);
  const parse = parseDecklist(source.text, { markdown: options.markdown ?? source.markdown });
  reportParse(parse, path === '-' ? 'stdin' : path);
  if (parse.entries.length === 0) {
    throw new Error('no cards found in the decklist');
  }
  const merged = mergeEntries(parse.entries);
  const resolve = await resolveDeck(merged, client);
  return { parse, resolve };
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
