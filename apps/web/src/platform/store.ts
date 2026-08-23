import {
  emptyCollection,
  emptyConfig,
  parseCollection,
  parseConfig,
  type Collection,
  type Config,
} from '@mtgproxy/core';
import { idbGet, idbSet } from './idb.js';

/**
 * Where the collection and config live.
 *
 * The same UI runs in two situations: as a static site, where the only durable
 * storage is the browser's, and served by `mtgproxy serve`, where it should read
 * and write the very same files the CLI uses. Both satisfy this interface so no
 * view has to know which one it got.
 */
export interface DataStore {
  readonly kind: 'browser' | 'server';
  /** Human-readable description of where data is being kept. */
  readonly location: string;
  loadCollection(): Promise<Collection>;
  saveCollection(collection: Collection): Promise<void>;
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
}

export class BrowserStore implements DataStore {
  readonly kind = 'browser' as const;
  readonly location = 'this browser';

  async loadCollection(): Promise<Collection> {
    const stored = await idbGet<unknown>('data', 'collection');
    if (!stored) return emptyCollection();
    // A hand-imported file can be malformed; fall back rather than trapping the
    // user in an app that will not boot.
    try {
      return parseCollection(stored.value);
    } catch {
      return emptyCollection();
    }
  }

  async saveCollection(collection: Collection): Promise<void> {
    await idbSet('data', 'collection', collection);
  }

  async loadConfig(): Promise<Config> {
    const stored = await idbGet<unknown>('data', 'config');
    if (!stored) return emptyConfig();
    try {
      return parseConfig(stored.value);
    } catch {
      return emptyConfig();
    }
  }

  async saveConfig(config: Config): Promise<void> {
    await idbSet('data', 'config', config);
  }
}

/** Talks to the local API exposed by `mtgproxy serve` (wired up in M4). */
export class ServerStore implements DataStore {
  readonly kind = 'server' as const;
  readonly location: string;

  constructor(location: string) {
    this.location = location;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
    return (await response.json()) as T;
  }

  async loadCollection(): Promise<Collection> {
    return parseCollection(await this.request('/api/collection'));
  }

  async saveCollection(collection: Collection): Promise<void> {
    await this.request('/api/collection', { method: 'PUT', body: JSON.stringify(collection) });
  }

  async loadConfig(): Promise<Config> {
    return parseConfig(await this.request('/api/config'));
  }

  async saveConfig(config: Config): Promise<void> {
    await this.request('/api/config', { method: 'PUT', body: JSON.stringify(config) });
  }
}

/**
 * Pick a store by asking whether a local server is answering.
 *
 * The probe is deliberately short and failure-tolerant: a static deployment has
 * nothing listening, and that is the normal case rather than an error.
 */
export async function detectStore(timeoutMs = 800): Promise<DataStore> {
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      const body = (await response.json()) as { collectionPath?: string };
      return new ServerStore(body.collectionPath ?? 'local mtgproxy server');
    }
  } catch {
    // No server: fall through to browser storage.
  }
  return new BrowserStore();
}
