import type { Config, PreferenceProfile, ResolveResult } from '@mtgproxy/core';

/**
 * Resolved decks, kept for the session.
 *
 * A cold resolution costs one request per distinct card, so re-running it just
 * because a view remounted is the difference between instant and a minute. The
 * key covers everything that can change the answer, so a changed preference or
 * a newly owned card yields a different entry rather than a stale hit.
 */

export const RESOLUTION_CACHE_LIMIT = 20;

const cache = new Map<string, ResolveResult>();
let hits = 0;
let misses = 0;

/** FNV-1a, so keys stay short rather than holding whole decklists. */
export function hashKey(input: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

export interface CacheKeyInput {
  text: string;
  profile: PreferenceProfile;
  config: Config;
  ownedKeys: ReadonlySet<string>;
}

export function makeCacheKey(input: CacheKeyInput): string {
  return hashKey(
    JSON.stringify({
      text: input.text,
      profile: input.profile,
      pins: input.config.pins ?? {},
      // preferOwned makes the collection part of the answer; without it the
      // collection cannot change which printing wins, so it stays out of the
      // key and adding a card does not throw away every cached deck.
      owned: input.profile.preferOwned ? [...input.ownedKeys].sort() : null,
    }),
  );
}

export function getCached(key: string): ResolveResult | undefined {
  const hit = cache.get(key);
  if (!hit) {
    misses += 1;
    return undefined;
  }
  hits += 1;
  // Re-insert so the map's insertion order doubles as recency.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function putCached(key: string, result: ResolveResult): void {
  cache.set(key, result);
  while (cache.size > RESOLUTION_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearResolutionCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

/** Entries currently held; for tests and diagnostics. */
export function cacheSize(): number {
  return cache.size;
}

/** Hit/miss counts, so a cache that silently never hits is visible. */
export function cacheStats(): { hits: number; misses: number; size: number } {
  return { hits, misses, size: cache.size };
}
