import type { BlobCache, CardCache, PrintsCache, ScryfallCard } from '@mtgtoolbox/core';
import { idbGet, idbSet } from './idb.js';

/**
 * Browser implementations of the cache interfaces `core` depends on.
 *
 * These mirror the CLI's disk caches, including their expiry rules: printing
 * lists go stale after a week because new printings appear when sets release,
 * and a cache that never expired would silently hide them. The two surfaces
 * must agree about what exists, so the lifetime is duplicated deliberately
 * rather than left to drift.
 */

export const PRINTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export class IdbCardCache implements CardCache {
  async get(key: string): Promise<ScryfallCard | undefined> {
    return (await idbGet<ScryfallCard>('cards', key))?.value;
  }
  async set(key: string, card: ScryfallCard): Promise<void> {
    await idbSet('cards', key, card);
  }
}

export class IdbPrintsCache implements PrintsCache {
  async get(name: string): Promise<ScryfallCard[] | undefined> {
    const stored = await idbGet<ScryfallCard[]>('prints', name);
    if (!stored) return undefined;
    if (Date.now() - stored.storedAt > PRINTS_MAX_AGE_MS) return undefined;
    return stored.value;
  }
  async set(name: string, cards: ScryfallCard[]): Promise<void> {
    await idbSet('prints', name, cards);
  }
}

export class IdbImageCache implements BlobCache {
  async get(key: string): Promise<Uint8Array | undefined> {
    const stored = await idbGet<ArrayBuffer>('images', key);
    return stored ? new Uint8Array(stored.value) : undefined;
  }
  async set(key: string, bytes: Uint8Array): Promise<void> {
    // Store the underlying buffer; structured clone handles it natively.
    await idbSet('images', key, bytes.buffer.slice(0) as ArrayBuffer);
  }
}
