import { describe, expect, it, vi } from 'vitest';
import { ScryfallClient, ScryfallError, DEFAULT_RATE_LIMIT_MS } from '../src/scryfall/client.js';
import { card } from './helpers.js';

/** A fetch stub returning a queued sequence of responses. */
function stubFetch(responses: Response[]) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return next;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

const rateLimited = (retryAfter?: string) =>
  new Response(JSON.stringify({ details: 'You are being rate-limited' }), {
    status: 429,
    ...(retryAfter ? { headers: { 'retry-after': retryAfter } } : {}),
  });

describe('rate limiting', () => {
  it('leaves headroom under Scryfall’s 10 requests per second', () => {
    // 100ms sits exactly on the ceiling; Scryfall requires strictly fewer.
    expect(1000 / DEFAULT_RATE_LIMIT_MS).toBeLessThan(10);
  });

  it('retries a rate-limited request and then succeeds', async () => {
    const { impl, calls } = stubFetch([
      rateLimited('0'),
      json({ data: [card({ name: 'Sol Ring' })], not_found: [] }),
    ]);
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0, retryBackoffMs: 0 });

    const result = await client.collection([{ name: 'Sol Ring' }]);
    expect(result.data).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('reports each retry so a pause is never silent', async () => {
    const seen: number[] = [];
    const { impl } = stubFetch([
      rateLimited('0'),
      rateLimited('0'),
      json({ data: [], not_found: [] }),
    ]);
    const client = new ScryfallClient({
      fetchImpl: impl,
      rateLimitMs: 0,
      onRetry: (info) => seen.push(info.attempt),
    });

    await client.collection([{ name: 'Sol Ring' }]);
    expect(seen).toEqual([1, 2]);
  });

  it('honours the Retry-After header', async () => {
    const waits: number[] = [];
    const { impl } = stubFetch([rateLimited('2'), json({ data: [], not_found: [] })]);
    const client = new ScryfallClient({
      fetchImpl: impl,
      rateLimitMs: 0,
      onRetry: (info) => waits.push(info.waitMs),
    });

    await client.collection([{ name: 'Sol Ring' }]);
    expect(waits).toEqual([2000]);
  });

  it('gives up rather than retrying forever', async () => {
    const { impl, calls } = stubFetch(Array.from({ length: 6 }, () => rateLimited('0')));
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0 });

    await expect(client.collection([{ name: 'Sol Ring' }])).rejects.toThrow(ScryfallError);
    // The initial attempt plus a bounded number of retries.
    expect(calls).toHaveLength(4);
  });

  it('retries a dropped connection', async () => {
    // A flaky link must not throw away a minute of resolution work.
    const calls: string[] = [];
    let first = true;
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      if (first) {
        first = false;
        throw new TypeError('Failed to fetch');
      }
      return json({ data: [], not_found: [] });
    }) as unknown as typeof fetch;

    const seen: string[] = [];
    const client = new ScryfallClient({
      fetchImpl: impl,
      rateLimitMs: 0,
      retryBackoffMs: 0,
      onRetry: (info) => seen.push(info.reason),
    });

    await client.collection([{ name: 'Sol Ring' }]);
    expect(calls).toHaveLength(2);
    expect(seen).toEqual(['network']);
  });

  it('gives up on a link that never comes back', async () => {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0, retryBackoffMs: 0 });

    await expect(client.collection([{ name: 'Sol Ring' }])).rejects.toThrow(/Failed to fetch/);
    expect(calls).toHaveLength(4);
  });

  it('does not retry an ordinary error', async () => {
    const { impl, calls } = stubFetch([
      new Response(JSON.stringify({ details: 'Not found' }), { status: 404 }),
    ]);
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0 });

    await expect(client.collection([{ name: 'Nope' }])).rejects.toThrow(/Not found/);
    expect(calls).toHaveLength(1);
  });
});

describe('search', () => {
  it('returns the cards a query matched and caches each one', async () => {
    const { impl, calls } = stubFetch([
      json({ data: [card({ name: 'Sol Ring', id: 'sol-1' })], has_more: false }),
    ]);
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0 });

    const found = await client.search('name:/sol ring/');
    expect(found.map((item) => item.name)).toEqual(['Sol Ring']);
    expect(calls[0]).toContain('unique=cards');

    // Cached by id and by name, so choosing a result and then resolving the
    // deck it lands in costs no further requests.
    const again = await client.collection([{ name: 'Sol Ring' }, { id: 'sol-1' }]);
    expect(again.data).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it('treats a query that matched nothing as empty rather than failing', async () => {
    const { impl } = stubFetch([
      new Response(JSON.stringify({ details: 'no cards found' }), { status: 404 }),
    ]);
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0, retryBackoffMs: 0 });
    await expect(client.search('name:/qqqq/')).resolves.toEqual([]);
  });

  it('does not ask Scryfall about a one-letter prefix', async () => {
    const { impl, calls } = stubFetch([]);
    const client = new ScryfallClient({ fetchImpl: impl, rateLimitMs: 0 });
    await expect(client.autocomplete('s')).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
