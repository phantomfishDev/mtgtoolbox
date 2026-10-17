import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve as resolvePath } from 'node:path';
import {
  parseCollection,
  parseConfig,
  readPins,
  setPinInDecklist,
  type DeckPin,
} from '@mtgproxy/core';
import {
  deckId,
  decksDir,
  listDecks,
  loadCollection,
  loadConfig,
  saveCollection,
  saveConfig,
  collectionPath,
  configPath,
} from '@mtgproxy/node';

/**
 * The local half of the web app.
 *
 * The same built site runs in two modes: against a static host, where the
 * browser is the only storage there is, and against this server, where the
 * collection, the config and the decklists are the very files the CLI uses.
 * The app decides which it got by asking `/api/health`, so everything here
 * exists to make that probe succeed and then to be honest about the files.
 *
 * Built on `node:http` rather than a framework: six routes do not justify a
 * dependency in a tool whose whole appeal is that it runs from a checkout.
 */

export interface ServeOptions {
  port: number;
  host: string;
  decks?: string;
  collection?: string;
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
    // A collection import is the largest thing posted here; past this it is
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
      collectionPath: collectionPath(options.collection),
      configPath: configPath(options.config),
      decksDir: dir,
    });
    return true;
  }

  if (pathname === '/api/collection') {
    if (method === 'GET') {
      sendJson(response, 200, (await loadCollection(options.collection)).data);
      return true;
    }
    if (method === 'PUT') {
      const path = await saveCollection(parseCollection(await readBody(request)), options.collection);
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

  if (pathname === '/api/decks' && method === 'GET') {
    const paths = await listDecks(dir);
    const decks = await Promise.all(
      paths.map(async (path) => {
        const text = await readFile(path, 'utf8');
        return { id: deckId(path), pins: readPins(text) };
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
      sendJson(response, 200, { id, text: after, pins: readPins(after), written: true, path });
      return true;
    }
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
