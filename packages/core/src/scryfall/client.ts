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
/**
 * Gap between requests.
 *
 * Scryfall asks for fewer than 10 requests per second. A 100ms gap sits exactly
 * on that ceiling rather than below it, and in practice earns a 429 — so the
 * default leaves headroom instead. This matters more than it used to: the
 * shipped preference profile is active, so a deck costs one request per
 * distinct card rather than two in total.
 */
export const DEFAULT_RATE_LIMIT_MS = 150;

/** How many times a failed request is retried before giving up. */
const MAX_RETRIES = 3;

export interface CardCache {
  get(key: string): Promise<ScryfallCard | undefined>;
  set(key: string, card: ScryfallCard): Promise<void>;
}

export interface PrintsCache {
  get(name: string): Promise<ScryfallCard[] | undefined>;
  set(name: string, cards: ScryfallCard[]): Promise<void>;
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
  printsCache?: PrintsCache;
  imageCache?: BlobCache;
  rateLimitMs?: number;
  /** Base delay for retry backoff, doubled per attempt. Set to 0 in tests. */
  retryBackoffMs?: number;
  /**
   * Scryfall asks for a descriptive User-Agent. Browsers forbid setting it, so
   * it is omitted there rather than producing a header the fetch layer drops.
   */
  userAgent?: string;
  /** Called before each network request; useful for progress reporting. */
  onRequest?: (url: string) => void;
  /** Called when a request failed and is about to be retried. */
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  /** Why the request is being retried. */
  reason: 'rate-limit' | 'network';
  waitMs: number;
  /** 1-based retry number. */
  attempt: number;
  message: string;
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
  private readonly retryBackoffMs: number;
  private readonly userAgent: string | undefined;
  private readonly onRequest: ((url: string) => void) | undefined;
  private readonly onRetry: ((info: RetryInfo) => void) | undefined;
  readonly imageCache: BlobCache | undefined;
  private readonly printsCache: PrintsCache | undefined;
  /** Serialises every request through one chain so the rate limit is global. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: ScryfallClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cardCache = options.cardCache ?? new MemoryCardCache();
    this.imageCache = options.imageCache;
    this.printsCache = options.printsCache;
    this.rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
    this.retryBackoffMs = options.retryBackoffMs ?? 1000;
    // `window` present means a browser, where User-Agent is a forbidden header.
    const inBrowser = typeof globalThis === 'object' && 'window' in globalThis;
    this.userAgent =
      options.userAgent ?? (inBrowser ? undefined : 'mtgtoolbox/0.2 (+https://github.com/phantomfishDev/mtgtoolbox)');
    this.onRequest = options.onRequest;
    this.onRetry = options.onRetry;
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
      for (let attempt = 0; ; attempt++) {
        const retry = async (info: RetryInfo): Promise<void> => {
          this.onRetry?.(info);
          await new Promise((resolve) => setTimeout(resolve, info.waitMs));
        };

        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            ...init,
            headers: {
              Accept: 'application/json',
              ...(this.userAgent ? { 'User-Agent': this.userAgent } : {}),
              ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
              ...init?.headers,
            },
          });
        } catch (cause) {
          // A dropped connection or a flaky link should not lose a minute of
          // resolution work, so transient failures are retried like a 429.
          if (attempt >= MAX_RETRIES) throw cause;
          const message = cause instanceof Error ? cause.message : String(cause);
          await retry({
            reason: 'network',
            waitMs: this.retryBackoffMs * 2 ** attempt,
            attempt: attempt + 1,
            message,
          });
          continue;
        }

        if (response.ok) return response;

        let detail = response.statusText;
        try {
          const body = (await response.json()) as { details?: string };
          if (body.details) detail = body.details;
        } catch {
          // Non-JSON error body; the status text is the best we have.
        }

        // Back off and retry rather than failing a long deck resolution
        // outright. Scryfall warns that ignoring a 429 leads to a network ban,
        // so the wait is deliberately generous and honours Retry-After.
        if (response.status === 429 && attempt < MAX_RETRIES) {
          const header = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
          const wait = Number.isFinite(header) ? header * 1000 : this.retryBackoffMs * 2 * 2 ** attempt;
          await retry({ reason: 'rate-limit', waitMs: wait, attempt: attempt + 1, message: detail });
          continue;
        }

        throw new ScryfallError(detail, response.status, url);
      }
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

  /**
   * Every printing of a card, newest first.
   *
   * This is what the preference engine ranks over, and it costs one request per
   * distinct card name rather than one per 75 cards, so results are cached
   * aggressively. An unknown name yields an empty list rather than throwing.
   *
   * `extras` adds `include:extras` to the query, which is the only way to see
   * tokens: the search endpoint hides them by default, so a plain `prints`
   * call for a token name comes back empty even though the token exists.
   * Cached under its own key, because the two queries answer differently.
   */
  async prints(name: string, options: { extras?: boolean } = {}): Promise<ScryfallCard[]> {
    const key = options.extras ? `extras:${name.toLowerCase()}` : name.toLowerCase();
    const cached = await this.printsCache?.get(key);
    if (cached) return cached;

    const query = options.extras
      ? `!"${name.replace(/"/g, '')}" include:extras`
      : `!"${name.replace(/"/g, '')}"`;
    let url: string | null =
      `${API}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc`;
    const all: ScryfallCard[] = [];

    try {
      while (url) {
        const response = await this.request(url);
        const body = (await response.json()) as {
          data: ScryfallCard[];
          has_more: boolean;
          next_page?: string;
        };
        all.push(...body.data);
        url = body.has_more ? (body.next_page ?? null) : null;
      }
    } catch (error) {
      // A name with no printings returns 404 from the search endpoint.
      if (error instanceof ScryfallError && error.status === 404) return [];
      throw error;
    }

    for (const card of all) {
      await this.cardCache.set(identifierKey({ id: card.id }), card);
    }
    await this.printsCache?.set(key, all);
    return all;
  }

  /**
   * Name suggestions for a partial name, as the search-as-you-type endpoint
   * returns them: at most 20 names, no card data.
   *
   * Deliberately uncached. The cache is keyed by card, and a prefix is not a
   * card; caching prefixes would fill it with every keystroke a person types.
   */
  async autocomplete(query: string): Promise<string[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    const response = await this.request(
      `${API}/cards/autocomplete?q=${encodeURIComponent(trimmed)}`,
    );
    const body = (await response.json()) as { data?: string[] };
    return body.data ?? [];
  }

  /**
   * Full-text card search, one printing per card.
   *
   * This is the picker's data source: a person typing half a name wants to see
   * the card and confirm it, which needs the whole object rather than a name.
   * Each result is cached by id and by name, so choosing one and then resolving
   * the deck it lands in costs nothing further.
   */
  async search(
    query: string,
    options: { unique?: 'cards' | 'prints' | 'art'; order?: string; limit?: number } = {},
  ): Promise<ScryfallCard[]> {
    const trimmed = query.trim();
    if (trimmed === '') return [];
    const { unique = 'cards', order = 'name', limit = 24 } = options;
    const url =
      `${API}/cards/search?q=${encodeURIComponent(trimmed)}` +
      `&unique=${unique}&order=${encodeURIComponent(order)}`;

    try {
      const response = await this.request(url);
      const body = (await response.json()) as { data: ScryfallCard[] };
      const cards = body.data.slice(0, limit);
      for (const card of cards) {
        await this.cardCache.set(identifierKey({ id: card.id }), card);
        await this.cardCache.set(identifierKey({ name: card.name }), card);
      }
      return cards;
    } catch (error) {
      // A search that matches nothing is a 404 here, not an empty page.
      if (error instanceof ScryfallError && error.status === 404) return [];
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
