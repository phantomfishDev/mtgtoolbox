import type { CardIdentifier, CollectionResponse, ScryfallCard } from './types.js';

/**
 * Scryfall HTTP client.
 *
 * Isomorphic by construction: `fetch`, the card cache and the clock are all
 * injectable, so the same client backs the CLI (disk cache) and the browser
 * (IndexedDB) without branching on platform.
 */

const API = 'https://api.scryfall.com';
/** `POST /cards/collection` accepts at most this many identifiers per request. */
export const COLLECTION_CHUNK_SIZE = 75;
/** Scryfall's API guidelines ask for 50-100ms between requests. */
export const DEFAULT_RATE_LIMIT_MS = 100;

export interface CardCache {
  get(key: string): Promise<ScryfallCard | undefined>;
  set(key: string, card: ScryfallCard): Promise<void>;
}

export interface BlobCache {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, bytes: Uint8Array): Promise<void>;
}

export class MemoryCardCache implements CardCache {
  private readonly map = new Map<string, ScryfallCard>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, card: ScryfallCard) {
    this.map.set(key, card);
  }
}

export interface ScryfallClientOptions {
  fetchImpl?: typeof fetch;
  cardCache?: CardCache;
  imageCache?: BlobCache;
  rateLimitMs?: number;
  /** Scryfall requires a descriptive User-Agent. */
  userAgent?: string;
  /** Called before each network request; useful for progress reporting. */
  onRequest?: (url: string) => void;
}

export class ScryfallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ScryfallError';
  }
}

/** Cache key for an identifier, so a name lookup and an id lookup never collide. */
export function identifierKey(id: CardIdentifier): string {
  if ('id' in id) return `id:${id.id}`;
  if ('set' in id) return `print:${id.set.toLowerCase()}:${id.collector_number.toLowerCase()}`;
  return `name:${id.name.toLowerCase()}`;
}

export class ScryfallClient {
  private readonly fetchImpl: typeof fetch;
  private readonly cardCache: CardCache;
  private readonly rateLimitMs: number;
  private readonly userAgent: string;
  private readonly onRequest: ((url: string) => void) | undefined;
  readonly imageCache: BlobCache | undefined;
  /** Serialises every request through one chain so the rate limit is global. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: ScryfallClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cardCache = options.cardCache ?? new MemoryCardCache();
    this.imageCache = options.imageCache;
    this.rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
    this.userAgent = options.userAgent ?? 'mtgproxy/0.1 (+https://github.com/drewbonddev/mtgproxy)';
    this.onRequest = options.onRequest;
  }

  /** Run `task` after the rate-limit gap has elapsed since the previous request. */
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.rateLimitMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
      return task();
    });
    // Keep the chain alive even when one request rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    return this.schedule(async () => {
      this.onRequest?.(url);
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...init?.headers,
        },
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.json()) as { details?: string };
          if (body.details) detail = body.details;
        } catch {
          // Non-JSON error body; the status text is the best we have.
        }
        throw new ScryfallError(detail, response.status, url);
      }
      return response;
    });
  }

  /**
   * Look up many cards at once, reading whatever is cached and requesting only
   * the remainder in chunks of {@link COLLECTION_CHUNK_SIZE}.
   */
  async collection(identifiers: readonly CardIdentifier[]): Promise<CollectionResponse> {
    const found: ScryfallCard[] = [];
    const notFound: CardIdentifier[] = [];
    const misses: CardIdentifier[] = [];

    for (const identifier of identifiers) {
      const cached = await this.cardCache.get(identifierKey(identifier));
      if (cached) found.push(cached);
      else misses.push(identifier);
    }

    for (let i = 0; i < misses.length; i += COLLECTION_CHUNK_SIZE) {
      const chunk = misses.slice(i, i + COLLECTION_CHUNK_SIZE);
      const response = await this.request(`${API}/cards/collection`, {
        method: 'POST',
        body: JSON.stringify({ identifiers: chunk }),
      });
      const body = (await response.json()) as CollectionResponse;

      // Cache under the identifier that was asked for, and under the card's own
      // id and printing, so later lookups hit regardless of how they're phrased.
      for (const card of body.data) {
        await this.cardCache.set(identifierKey({ id: card.id }), card);
        await this.cardCache.set(
          identifierKey({ set: card.set, collector_number: card.collector_number }),
          card,
        );
        await this.cardCache.set(identifierKey({ name: card.name }), card);
      }
      const requestedByName = chunk.filter((id): id is { name: string } => 'name' in id);
      for (const id of requestedByName) {
        const card = body.data.find((c) => c.name.toLowerCase() === id.name.toLowerCase());
        if (card) await this.cardCache.set(identifierKey(id), card);
      }

      found.push(...body.data);
      notFound.push(...(body.not_found ?? []));
    }

    return { data: found, not_found: notFound };
  }

  /** Fuzzy single-card lookup, used to rescue names the batch endpoint missed. */
  async named(name: string, fuzzy = true): Promise<ScryfallCard | null> {
    const key = `${fuzzy ? 'fuzzy' : 'exact'}:${name.toLowerCase()}`;
    const cached = await this.cardCache.get(key);
    if (cached) return cached;
    try {
      const param = fuzzy ? 'fuzzy' : 'exact';
      const response = await this.request(
        `${API}/cards/named?${param}=${encodeURIComponent(name)}`,
      );
      const card = (await response.json()) as ScryfallCard;
      await this.cardCache.set(key, card);
      await this.cardCache.set(identifierKey({ id: card.id }), card);
      return card;
    } catch (error) {
      // 404 means no match; a fuzzy 404 can also mean the name was ambiguous.
      if (error instanceof ScryfallError && error.status === 404) return null;
      throw error;
    }
  }

  /** Fetch card image bytes, reading through the image cache when present. */
  async image(url: string, cacheKey: string): Promise<Uint8Array> {
    const cached = await this.imageCache?.get(cacheKey);
    if (cached) return cached;
    const response = await this.request(url, { headers: { Accept: 'image/*' } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    await this.imageCache?.set(cacheKey, bytes);
    return bytes;
  }
}
