import { ScryfallClient, type RetryInfo } from '@mtgtoolbox/core';
import { IdbCardCache, IdbImageCache, IdbPrintsCache } from './caches.js';

/**
 * One client for the whole session.
 *
 * The rate limiter is per-instance and serialises every request through a single
 * chain, so sharing one instance is what actually keeps the app within
 * Scryfall's request guidelines. Creating a client per component would defeat it.
 */

type RetryListener = (info: RetryInfo) => void;
const retryListeners = new Set<RetryListener>();

/**
 * Watch for retries.
 *
 * The client is a module singleton with no route into React state, so it
 * broadcasts instead. Without this a backoff pause — up to several seconds —
 * reads as the app having hung.
 */
export function subscribeToRetries(listener: RetryListener): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

let client: ScryfallClient | null = null;

export function getClient(): ScryfallClient {
  client ??= new ScryfallClient({
    cardCache: new IdbCardCache(),
    printsCache: new IdbPrintsCache(),
    imageCache: new IdbImageCache(),
    onRetry: (info) => {
      for (const listener of retryListeners) listener(info);
    },
  });
  return client;
}
