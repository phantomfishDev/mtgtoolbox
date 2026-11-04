import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  newWorkshopSession,
  parseWorkshopSession,
  type WorkshopSession,
} from '@mtgproxy/core';

/**
 * Where a deck-building session lives.
 *
 * One directory per deck under `.workshop/`, holding the session file the UI
 * and the agent both write. It sits in the working tree rather than under
 * `~/.config` on purpose: a session is work in progress on *this* checkout's
 * decks, and an agent should be able to read it with the same file tools it
 * reads the decklists with. It is scratch, so it is gitignored.
 */

export const SESSION_FILENAME = 'session.json';
/** Where an agent drops a proposal for `workshop propose` to pick up. */
export const PROPOSAL_FILENAME = 'proposal.json';

export function workshopDir(override?: string): string {
  const fromEnv = process.env['MTGPROXY_WORKSHOP'];
  return resolve(override ?? (fromEnv && fromEnv.trim() !== '' ? fromEnv : '.workshop'));
}

/** A slug safe to use as a directory name and as a decklist filename. */
export function workshopSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (slug === '') throw new Error(`cannot make a deck name out of "${name}"`);
  return slug;
}

export function sessionDir(slug: string, override?: string): string {
  // The slug reaches here from a URL in the server, so rule out traversal.
  if (slug === '' || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw new Error(`invalid session name "${slug}"`);
  }
  return join(workshopDir(override), slug);
}

export function sessionPath(slug: string, override?: string): string {
  return join(sessionDir(slug, override), SESSION_FILENAME);
}

export function proposalPath(slug: string, override?: string): string {
  return join(sessionDir(slug, override), PROPOSAL_FILENAME);
}

export async function loadWorkshopSession(
  slug: string,
  override?: string,
): Promise<WorkshopSession | null> {
  const path = sessionPath(slug, override);
  try {
    return parseWorkshopSession(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(`session file at ${path} is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Write the session, atomically.
 *
 * Two writers share this file — the server, when the person saves, and an
 * agent, when it proposes — so a half-written file is a real possibility and a
 * rename is the cheapest way to rule it out.
 */
export async function saveWorkshopSession(
  session: WorkshopSession,
  override?: string,
): Promise<string> {
  const path = sessionPath(session.slug, override);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
  return path;
}

/** Load a session, creating an empty one on first use. */
export async function openWorkshopSession(
  slug: string,
  title?: string,
  override?: string,
): Promise<{ session: WorkshopSession; created: boolean; path: string }> {
  const existing = await loadWorkshopSession(slug, override);
  if (existing) {
    // A title given on a later run is a rename, not a reset.
    const session = title && title !== existing.title ? { ...existing, title } : existing;
    return { session, created: false, path: sessionPath(slug, override) };
  }
  const session = newWorkshopSession(slug, title);
  return { session, created: true, path: await saveWorkshopSession(session, override) };
}

/** Every session on disk, newest first. */
export async function listWorkshopSessions(override?: string): Promise<WorkshopSession[]> {
  const dir = workshopDir(override);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const sessions: WorkshopSession[] = [];
  for (const name of names.sort()) {
    try {
      const session = await loadWorkshopSession(name, override);
      if (session) sessions.push(session);
    } catch {
      // A broken session should not hide the working ones.
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
