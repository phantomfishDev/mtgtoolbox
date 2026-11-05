import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  faceImageUrl,
  isCut,
  saveBrief,
  saveReview,
  submitBrief,
  submitReview,
  type ScryfallCard,
  type WorkshopBrief,
  type WorkshopReview,
  type WorkshopSession,
} from '@mtgtoolbox/core';
import { loadWorkshopSession, saveWorkshopSession, sessionPath } from '@mtgtoolbox/node';
import { ScryfallClient } from '@mtgtoolbox/core';

/**
 * The workshop server: the person's half of a deck-building session.
 *
 * Small on purpose. It serves one page, searches Scryfall on that page's
 * behalf, and edits the parts of the session file that belong to the person —
 * the brief and the review. It never writes a proposal: that is the agent's
 * side, and keeping the two halves in different writers is what makes the
 * phase handshake honest.
 *
 * Every request re-reads the session from disk rather than holding it in
 * memory, so a proposal an agent writes while the page is open is picked up by
 * the next poll with no restart and no shared state.
 */

export interface WorkshopServerOptions {
  slug: string;
  /** 0 asks the OS for a free port, which is how this never clashes. */
  port: number;
  host: string;
  client: ScryfallClient;
  /** Workshop directory override, for tests and odd layouts. */
  dir?: string;
}

export interface RunningWorkshop {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A session with a hundred cards and a comment on each is tens of
    // kilobytes; past a megabyte something is wrong rather than large.
    if (size > 4 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The page, read from the build output and then from the source tree.
 *
 * Read fresh on every request rather than cached: the page is 40 KB served to
 * one person on loopback, and a cached copy means editing the UI and reloading
 * the browser silently shows the old one until the server is restarted.
 */
async function loadPage(): Promise<string> {
  const candidates = [
    new URL('./ui.html', import.meta.url),
    // dist/workshop/server.js -> src/workshop/ui.html
    new URL('../../src/workshop/ui.html', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(fileURLToPath(candidate), 'utf8');
    } catch {
      // Try the next location.
    }
  }
  throw new Error('workshop UI not found; run `pnpm --filter @mtgtoolbox/cli build`');
}

/** The card fields the picker and the review screen actually draw. */
export function cardForUi(card: ScryfallCard): Record<string, unknown> {
  const face = card.card_faces?.[0];
  return {
    name: card.name,
    set: card.set,
    collectorNumber: card.collector_number,
    scryfallId: card.id,
    manaCost: card.mana_cost ?? face?.mana_cost ?? '',
    typeLine: card.type_line ?? face?.type_line ?? '',
    cmc: card.cmc ?? 0,
    colorIdentity: card.color_identity ?? [],
    oracleText: card.oracle_text ?? face?.oracle_text ?? '',
    image:
      card.image_uris?.small ??
      face?.image_uris?.small ??
      faceImageUrl(card, 'normal') ??
      undefined,
    gameChanger: card.game_changer ?? false,
    // Display only: the session schema keeps the fields above.
    setName: card.set_name,
    rarity: card.rarity,
  };
}

/**
 * Turn what the person typed into a Scryfall query.
 *
 * The typed text goes in untouched, because Scryfall already does the right
 * thing with it: bare words are matched as substrings of the card name, so
 * "sol ri" finds Sol Ring and "nazg" finds Nazgûl, and punctuation in the real
 * name does not have to be reproduced. That also means someone who knows the
 * query language can type `t:dragon cmc<=3` into the same box.
 */
export function buildQuery(
  input: string,
  options: { commanders?: boolean; colors?: string } = {},
): string {
  const parts = [input.trim()];
  // Keep tokens, art cards and the digital-only sets out of a picker for a
  // deck that is going to be printed.
  parts.push('-is:token', '-layout:art_series', 'game:paper');
  // One printing per card, and the original one: a picker that shows the
  // newest printing shows crossover and Secret Lair art, which is not what
  // these decks are for. The printing is chosen later anyway — this is only
  // the thumbnail someone recognises the card by.
  if (!/\bprefer:/.test(input)) parts.push('prefer:oldest');
  if (options.commanders) parts.push('is:commander', 'legal:commander');
  if (options.colors) parts.push(`identity<=${options.colors}`);
  return parts.join(' ');
}

/**
 * Put the card the person most likely meant first.
 *
 * Scryfall can only order by name, so a two-word fragment buries its best match
 * among everything else alphabetically ahead of it: "sol ri" matches thirty-odd
 * cards and Sol Ring is not the first of them. Ranking here is what makes the
 * box feel like it is reading along.
 */
export function rankCards(cards: readonly ScryfallCard[], typed: string): ScryfallCard[] {
  const needle = typed.trim().toLowerCase();
  const score = (card: ScryfallCard): number => {
    const name = card.name.toLowerCase();
    if (name === needle) return 0;
    if (name.startsWith(needle)) return 1;
    // The front face of a double-faced card is what people type.
    if (name.split('//')[0]?.trim() === needle) return 1;
    if (name.includes(needle)) return 2;
    return 3;
  };
  return [...cards].sort(
    (a, b) => score(a) - score(b) || a.name.length - b.name.length || a.name.localeCompare(b.name),
  );
}

/** A renamed deck keeps its slug: the filename is already in use elsewhere. */
function retitle(session: WorkshopSession, title: string | undefined): WorkshopSession {
  const trimmed = (title ?? '').trim();
  return trimmed === '' || trimmed === session.title ? session : { ...session, title: trimmed };
}

async function handleApi(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkshopServerOptions,
): Promise<boolean> {
  const { pathname } = url;
  const method = request.method ?? 'GET';
  const { slug, dir } = options;

  /** The session as it is on disk right now, agent writes included. */
  const current = async (): Promise<WorkshopSession> => {
    const session = await loadWorkshopSession(slug, dir);
    if (!session) throw new Error(`no workshop session named ${slug}`);
    return session;
  };

  const write = async (session: WorkshopSession): Promise<void> => {
    await saveWorkshopSession(session, dir);
    sendJson(response, 200, { session, path: sessionPath(slug, dir) });
  };

  if (pathname === '/api/health') {
    sendJson(response, 200, { ok: true, slug, path: sessionPath(slug, dir) });
    return true;
  }

  if (pathname === '/api/session' && method === 'GET') {
    const session = await current();
    sendJson(response, 200, { session, path: sessionPath(slug, dir) });
    return true;
  }

  if (pathname === '/api/brief' && method === 'PUT') {
    const body = (await readBody(request)) as { brief?: WorkshopBrief; title?: string };
    if (!body?.brief) throw new Error('brief is required');
    await write(retitle(saveBrief(await current(), body.brief), body.title));
    return true;
  }

  if (pathname === '/api/brief/submit' && method === 'POST') {
    const body = (await readBody(request)) as { brief?: WorkshopBrief; title?: string };
    if (!body?.brief) throw new Error('brief is required');
    await write(retitle(submitBrief(await current(), body.brief), body.title));
    return true;
  }

  // Second thoughts after sending: take the turn back rather than making the
  // person wait for a proposal they already know they want changed.
  if (pathname === '/api/brief/reopen' && method === 'POST') {
    const session = await current();
    await write({ ...session, phase: 'intake', updatedAt: new Date().toISOString(), updatedBy: 'user' });
    return true;
  }

  if (pathname === '/api/review' && method === 'PUT') {
    const body = (await readBody(request)) as { review?: WorkshopReview };
    if (!body?.review) throw new Error('review is required');
    await write(saveReview(await current(), body.review));
    return true;
  }

  if (pathname === '/api/review/submit' && method === 'POST') {
    const body = (await readBody(request)) as { review?: WorkshopReview };
    if (!body?.review) throw new Error('review is required');
    const session = await current();
    const review = body.review;
    // Cutting a card and accepting the deck in the same click would leave the
    // export disagreeing with what the person saw, so say so instead.
    if (review.verdict === 'accept' && review.cuts.length > 0) {
      const stillCut = session.proposal?.cards.filter((card) => isCut(review, card.name)) ?? [];
      if (stillCut.length > 0) {
        sendJson(response, 400, {
          error: `accepting a deck with ${stillCut.length} card(s) still marked cut; un-cut them or send the review back for a revision`,
        });
        return true;
      }
    }
    await write(submitReview(session, review));
    return true;
  }

  if (pathname === '/api/cards' && method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    if (query.trim().length < 2) {
      sendJson(response, 200, { cards: [] });
      return true;
    }
    const built = buildQuery(query, {
      commanders: url.searchParams.get('commanders') === '1',
      ...(url.searchParams.get('colors') ? { colors: url.searchParams.get('colors')! } : {}),
    });
    try {
      // A whole page is fetched and ranked locally; the page is one request
      // either way, and ranking needs more than the first 24 names.
      const cards = await options.client.search(built, { limit: 175 });
      const ranked = rankCards(cards, query).slice(0, 24);
      sendJson(response, 200, { cards: ranked.map(cardForUi), query: built });
    } catch (error) {
      // A malformed query is the person's typing, not a server failure.
      sendJson(response, 200, {
        cards: [],
        query: built,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: `no route for ${method} ${pathname}` });
    return true;
  }
  return false;
}

export async function serveWorkshop(options: WorkshopServerOptions): Promise<RunningWorkshop> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (await handleApi(url, request, response, options)) return;
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const page = await loadPage();
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end(page);
          return;
        }
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('not found\n');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!response.headersSent) sendJson(response, 400, { error: message });
        else response.end();
      }
    })();
  });

  await new Promise<void>((ready, failed) => {
    server.once('error', failed);
    // Loopback only: this writes to the working tree.
    server.listen(options.port, options.host, ready);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    url: `http://${options.host}:${port}`,
    port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
