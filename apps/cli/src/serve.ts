import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve as resolvePath } from 'node:path';
import {
  buildDeckData,
  buildDeckIndex,
  buildDeckIndexEntry,
  mergeEntries,
  parsePrinted,
  parseConfig,
  parseDeckMeta,
  parseDecklist,
  readPins,
  resolveFromDeckDataWithLookups,
  selectForTokenMode,
  setDeckName,
  setPinInDecklist,
  totalCards,
  type DeckPin,
} from '@mtgproxy/core';
import {
  deckId,
  decksDir,
  listDecks,
  loadDeckData,
  loadDeckIndex,
  saveDeckData,
  saveDeckIndex,
  loadPrinted,
  loadConfig,
  savePrinted,
  saveConfig,
  printedPath,
  configPath,
} from '@mtgproxy/node';
import { makeClient } from './deck.js';
import { resolveProfile } from './prefs.js';

/**
 * The local half of the web app.
 *
 * The same built site runs in two modes: against a static host, where the
 * browser is the only storage there is, and against this server, where the
 * printed ledger, the config and the decklists are the very files the CLI uses.
 * The app decides which it got by asking `/api/health`, so everything here
 * exists to make that probe succeed and then to be honest about the files.
 *
 * Built on `node:http` rather than a framework: a handful of routes do not justify a
 * dependency in a tool whose whole appeal is that it runs from a checkout.
 */

export interface ServeOptions {
  port: number;
  host: string;
  decks?: string;
  printed?: string;
  config?: string;
  /** Directory of a built web app to serve at `/`. Optional. */
  site?: string;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    // A decklist is the largest thing posted here; past this it is
    // something going wrong rather than something worth buffering.
    if (size > 32 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The decklist for an id, refusing anything that escapes the decks directory.
 *
 * Ids arrive from the URL, so `..` and absolute paths have to be ruled out
 * before they become a file path — this process can write.
 */
async function deckPathFor(dir: string, id: string): Promise<string | null> {
  if (id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return null;
  const paths = await listDecks(dir);
  return paths.find((path) => deckId(path) === id) ?? null;
}

function isPin(value: unknown): value is DeckPin {
  if (typeof value !== 'object' || value === null) return false;
  const pin = value as Record<string, unknown>;
  return typeof pin['set'] === 'string' && typeof pin['collectorNumber'] === 'string';
}

/**
 * Bring a deck's stored card data and its index entry up to date with its file.
 *
 * A pin rewrites the decklist but not the `.cards.json` beside it or the deck
 * index, and the index is where the deck list gets its commander art — so
 * without this a pinned commander reverts on the list the next time the app
 * loads. Only the cheap path is taken: stored data plus a direct lookup of the
 * printings it lacks, one request however many pins there are. When the stored
 * data cannot be applied at all (a changed profile, new cards) nothing is
 * written, and `mtgproxy sync` remains the way to re-rank the deck.
 */
async function refreshStoredDeck(path: string, dir: string, options: ServeOptions): Promise<void> {
  const stored = await loadDeckData(path);
  if (!stored) return;

  const id = deckId(path);
  const { profile } = await resolveProfile({ config: options.config });
  const parsed = parseDecklist(await readFile(path, 'utf8'));
  // Tokens included, as sync stores them, so every token mode reads from the file.
  const merged = mergeEntries(selectForTokenMode(parsed.entries, 'include'));
  const applied = await resolveFromDeckDataWithLookups(merged, stored, makeClient(true), profile);
  if (!applied) {
    console.warn(`  ${id}: stored data is out of date; run \`mtgproxy sync\``);
    return;
  }

  const resolved = applied.result.resolved;
  await saveDeckData(path, buildDeckData(id, resolved, profile));

  // Replace just this deck's entry; the rest of the index stays as sync left it.
  const index = await loadDeckIndex(dir);
  const entry = buildDeckIndexEntry(id, parsed.entries, resolved, totalCards(parsed.entries));
  const others = (index?.decks ?? []).filter((deck) => deck.id !== id);
  await saveDeckIndex(dir, buildDeckIndex([...others, entry], profile));
}

async function handleApi(
  url: URL,
  request: IncomingMessage,
  response: ServerResponse,
  options: ServeOptions,
): Promise<boolean> {
  const { pathname } = url;
  const method = request.method ?? 'GET';
  const dir = decksDir(options.decks);

  if (pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      printedPath: printedPath(options.printed),
      configPath: configPath(options.config),
      decksDir: dir,
    });
    return true;
  }

  if (pathname === '/api/printed') {
    if (method === 'GET') {
      sendJson(response, 200, (await loadPrinted(options.printed)).data);
      return true;
    }
    if (method === 'PUT') {
      const path = await savePrinted(parsePrinted(await readBody(request)), options.printed);
      sendJson(response, 200, { ok: true, path });
      return true;
    }
  }

  if (pathname === '/api/config') {
    if (method === 'GET') {
      sendJson(response, 200, (await loadConfig(options.config)).data);
      return true;
    }
    if (method === 'PUT') {
      const path = await saveConfig(parseConfig(await readBody(request)), options.config);
      sendJson(response, 200, { ok: true, path });
      return true;
    }
  }

  // The deck index straight from disk. The built site carries a copy from build
  // time, which goes stale the moment a pin refreshes the real one.
  if (pathname === '/api/index' && method === 'GET') {
    const index = await loadDeckIndex(dir);
    if (!index) {
      sendJson(response, 404, { error: `no deck index in ${dir}` });
      return true;
    }
    sendJson(response, 200, index);
    return true;
  }

  if (pathname === '/api/decks' && method === 'GET') {
    const paths = await listDecks(dir);
    const decks = await Promise.all(
      paths.map(async (path) => {
        const text = await readFile(path, 'utf8');
        return { id: deckId(path), name: parseDeckMeta(text).name, pins: readPins(text) };
      }),
    );
    sendJson(response, 200, { dir, decks });
    return true;
  }

  // /api/decks/<id>/pins
  const pinsRoute = pathname.match(/^\/api\/decks\/([^/]+)\/pins$/);
  if (pinsRoute) {
    const id = decodeURIComponent(pinsRoute[1] ?? '');
    const path = await deckPathFor(dir, id);
    if (!path) {
      sendJson(response, 404, { error: `no deck named ${id}` });
      return true;
    }

    if (method === 'GET') {
      const text = await readFile(path, 'utf8');
      sendJson(response, 200, { id, text, pins: readPins(text) });
      return true;
    }

    if (method === 'PUT') {
      const body = (await readBody(request)) as { name?: unknown; pin?: unknown } | undefined;
      const name = typeof body?.name === 'string' ? body.name : '';
      if (name === '') {
        sendJson(response, 400, { error: 'name is required' });
        return true;
      }
      const pin = body?.pin === null || body?.pin === undefined ? null : body.pin;
      if (pin !== null && !isPin(pin)) {
        sendJson(response, 400, { error: 'pin must be {set, collectorNumber} or null' });
        return true;
      }

      const before = await readFile(path, 'utf8');
      const after = setPinInDecklist(before, name, pin);
      if (after === before) {
        // Either the card is not in this deck or it already reads this way.
        sendJson(response, 200, { id, text: before, pins: readPins(before), written: false, path });
        return true;
      }
      await writeFile(path, after, 'utf8');
      // Awaited so the app's next read of the index already has the new
      // printing; a failure here must not undo or hide the pin that was saved.
      try {
        await refreshStoredDeck(path, dir, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`  ${id}: could not refresh stored data (${message}); run \`mtgproxy sync\``);
      }
      sendJson(response, 200, { id, text: after, pins: readPins(after), written: true, path });
      return true;
    }
  }

  // /api/decks/<id>/name
  const nameRoute = pathname.match(/^\/api\/decks\/([^/]+)\/name$/);
  if (nameRoute && method === 'PUT') {
    const id = decodeURIComponent(nameRoute[1] ?? '');
    const path = await deckPathFor(dir, id);
    if (!path) {
      sendJson(response, 404, { error: `no deck named ${id}` });
      return true;
    }
    const body = (await readBody(request)) as { name?: unknown } | undefined;
    if (body?.name !== null && typeof body?.name !== 'string') {
      sendJson(response, 400, { error: 'name must be a string or null' });
      return true;
    }

    const before = await readFile(path, 'utf8');
    const after = setDeckName(before, body.name);
    if (after !== before) await writeFile(path, after, 'utf8');
    sendJson(response, 200, { id, name: parseDeckMeta(after).name, written: after !== before, path });
    return true;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: `no route for ${method} ${pathname}` });
    return true;
  }
  return false;
}

/** Serve the built web app, when one was pointed at. */
async function handleStatic(url: URL, response: ServerResponse, site: string): Promise<boolean> {
  const root = resolvePath(site);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = resolvePath(join(root, decodeURIComponent(requested)));
  // Keep traversal inside the site directory.
  if (target !== root && !target.startsWith(root + '/')) return false;

  for (const candidate of [target, join(root, 'index.html')]) {
    try {
      const body = await readFile(candidate);
      response.writeHead(200, {
        'Content-Type': MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
      });
      response.end(body);
      return true;
    } catch {
      // Fall through to the index, so a client-side route still loads.
    }
  }
  return false;
}

export async function serve(options: ServeOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (await handleApi(url, request, response, options)) return;
        if (options.site && (await handleStatic(url, response, options.site))) return;
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
    // Bound to the loopback interface by default: this process writes to the
    // user's files, and nothing about it should be reachable from the network.
    server.listen(options.port, options.host, ready);
  });

  return {
    url: `http://${options.host}:${options.port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
