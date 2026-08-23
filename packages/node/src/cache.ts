import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BlobCache, CardCache, PrintsCache, ScryfallCard } from '@mtgproxy/core';
import { cardCacheDir, imageCacheDir, printsCacheDir } from './paths.js';

/**
 * Disk-backed caches.
 *
 * Card JSON and image bytes are cached separately because they age differently:
 * a card's data can be re-fetched cheaply, whereas images are the expensive part
 * and are effectively immutable once Scryfall has a high-resolution scan.
 */

/** Cache keys contain characters that are unsafe in filenames, so hash them. */
function fileFor(dir: string, key: string, extension: string): string {
  const digest = createHash('sha256').update(key).digest('hex');
  // Shard by the first two hex characters to avoid one enormous directory.
  return join(dir, digest.slice(0, 2), `${digest}${extension}`);
}

async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  const { rename } = await import('node:fs/promises');
  await rename(temporary, path);
}

export interface FileCacheOptions {
  dir?: string;
  /** Entries older than this are treated as absent. Omit for no expiry. */
  maxAgeMs?: number;
}

export class FileCardCache implements CardCache {
  private readonly dir: string;
  private readonly maxAgeMs: number | undefined;

  constructor(options: FileCacheOptions = {}) {
    this.dir = options.dir ?? cardCacheDir();
    this.maxAgeMs = options.maxAgeMs;
  }

  async get(key: string): Promise<ScryfallCard | undefined> {
    const path = fileFor(this.dir, key, '.json');
    try {
      if (this.maxAgeMs !== undefined) {
        const info = await stat(path);
        if (Date.now() - info.mtimeMs > this.maxAgeMs) return undefined;
      }
      return JSON.parse(await readFile(path, 'utf8')) as ScryfallCard;
    } catch {
      // A missing or unreadable entry is a cache miss, never an error.
      return undefined;
    }
  }

  async set(key: string, card: ScryfallCard): Promise<void> {
    await writeAtomic(fileFor(this.dir, key, '.json'), JSON.stringify(card));
  }
}

/**
 * Caches the full printing list for a card name.
 *
 * These lists are the expensive part of preference-aware resolution — one
 * request per distinct name — so they are given a long but finite lifetime:
 * new printings appear when sets release, and a stale list would silently hide
 * them.
 */
export class FilePrintsCache implements PrintsCache {
  private readonly dir: string;
  private readonly maxAgeMs: number;

  constructor(options: FileCacheOptions = {}) {
    this.dir = options.dir ?? printsCacheDir();
    this.maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async get(name: string): Promise<ScryfallCard[] | undefined> {
    const path = fileFor(this.dir, name, '.json');
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > this.maxAgeMs) return undefined;
      return JSON.parse(await readFile(path, 'utf8')) as ScryfallCard[];
    } catch {
      return undefined;
    }
  }

  async set(name: string, cards: ScryfallCard[]): Promise<void> {
    await writeAtomic(fileFor(this.dir, name, '.json'), JSON.stringify(cards));
  }
}

export class FileImageCache implements BlobCache {
  private readonly dir: string;

  constructor(options: FileCacheOptions = {}) {
    this.dir = options.dir ?? imageCacheDir();
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(fileFor(this.dir, key, '.img')));
    } catch {
      return undefined;
    }
  }

  async set(key: string, bytes: Uint8Array): Promise<void> {
    await writeAtomic(fileFor(this.dir, key, '.img'), bytes);
  }
}

export interface CacheStats {
  files: number;
  bytes: number;
}

async function measure(dir: string): Promise<CacheStats> {
  let files = 0;
  let bytes = 0;
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        files += 1;
        bytes += (await stat(path)).size;
      }
    }
  };
  await walk(dir);
  return { files, bytes };
}

export async function cacheStats(): Promise<{
  cards: CacheStats;
  prints: CacheStats;
  images: CacheStats;
}> {
  return {
    cards: await measure(cardCacheDir()),
    prints: await measure(printsCacheDir()),
    images: await measure(imageCacheDir()),
  };
}

export type CacheKind = 'cards' | 'prints' | 'images' | 'all';

export async function clearCache(which: CacheKind = 'all'): Promise<void> {
  const targets: Record<Exclude<CacheKind, 'all'>, string> = {
    cards: cardCacheDir(),
    prints: printsCacheDir(),
    images: imageCacheDir(),
  };
  for (const [kind, dir] of Object.entries(targets)) {
    if (which === 'all' || which === kind) await rm(dir, { recursive: true, force: true });
  }
}
