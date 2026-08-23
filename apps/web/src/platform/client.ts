import { ScryfallClient } from '@mtgproxy/core';
import { IdbCardCache, IdbImageCache, IdbPrintsCache } from './caches.js';

/**
 * One client for the whole session.
 *
 * The rate limiter is per-instance and serialises every request through a single
 * chain, so sharing one instance is what actually keeps the app within
 * Scryfall's request guidelines. Creating a client per component would defeat it.
 */
let client: ScryfallClient | null = null;

export function getClient(): ScryfallClient {
  client ??= new ScryfallClient({
    cardCache: new IdbCardCache(),
    printsCache: new IdbPrintsCache(),
    imageCache: new IdbImageCache(),
  });
  return client;
}
