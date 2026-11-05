import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESOLUTION_CACHE_LIMIT,
  cacheSize,
  cacheStats,
  clearResolutionCache,
  getCached,
  makeCacheKey,
  putCached,
} from '../src/resolution-cache.js';
import type { Config, PreferenceProfile, ResolveResult } from '@mtgtoolbox/core';

const result = (label: string) =>
  ({ resolved: [], unresolved: [], warnings: [{ code: 'double-faced', message: label }] } as unknown as ResolveResult);

const base = {
  text: '1 Sol Ring',
  profile: {} as PreferenceProfile,
  config: {} as Config,
};

beforeEach(clearResolutionCache);

describe('makeCacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(makeCacheKey(base)).toBe(makeCacheKey({ ...base }));
  });

  it('changes with the decklist', () => {
    expect(makeCacheKey({ ...base, text: '1 Swamp' })).not.toBe(makeCacheKey(base));
  });

  it('changes with the preference profile', () => {
    const other = { ...base, profile: { fullArt: 'prefer' } as PreferenceProfile };
    expect(makeCacheKey(other)).not.toBe(makeCacheKey(base));
  });

  it('changes with pinned printings', () => {
    const pinned = {
      ...base,
      config: { pins: { 'sol ring': { set: 'ltc', collectorNumber: '264' } } } as Config,
    };
    expect(makeCacheKey(pinned)).not.toBe(makeCacheKey(base));
  });

  it('changes with the token mode', () => {
    expect(makeCacheKey({ ...base, tokenMode: 'include' })).not.toBe(makeCacheKey(base));
    expect(makeCacheKey({ ...base, tokenMode: 'exclude' })).toBe(makeCacheKey(base));
  });

  it('does not depend on the order cards were added to the collection', () => {
    const a = { ...base, ownedKeys: new Set(['a', 'b']) };
    const b = { ...base, ownedKeys: new Set(['b', 'a']) };
    expect(makeCacheKey(a)).toBe(makeCacheKey(b));
  });
});

describe('cache storage', () => {
  it('returns what was stored', () => {
    putCached('k', result('one'));
    expect(getCached('k')?.warnings[0]?.message).toBe('one');
  });

  it('misses on an unknown key', () => {
    expect(getCached('nope')).toBeUndefined();
  });

  it('evicts the least recently used entry past the limit', () => {
    for (let i = 0; i < RESOLUTION_CACHE_LIMIT; i++) putCached(`k${i}`, result(`r${i}`));
    expect(cacheSize()).toBe(RESOLUTION_CACHE_LIMIT);

    // Touch the oldest so it is no longer the eviction candidate.
    getCached('k0');
    putCached('overflow', result('new'));

    expect(cacheSize()).toBe(RESOLUTION_CACHE_LIMIT);
    expect(getCached('k0')).toBeDefined();
    expect(getCached('k1')).toBeUndefined();
  });

  it('counts hits and misses, so a cache that never hits is visible', () => {
    expect(cacheStats()).toEqual({ hits: 0, misses: 0, size: 0 });
    getCached('absent');
    putCached('k', result('one'));
    getCached('k');
    getCached('k');
    expect(cacheStats()).toEqual({ hits: 2, misses: 1, size: 1 });
  });

  it('clears everything', () => {
    putCached('k', result('one'));
    getCached('k');
    clearResolutionCache();
    expect(cacheStats()).toEqual({ hits: 0, misses: 0, size: 0 });
  });
});
