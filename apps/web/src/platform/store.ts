import {
  emptyConfig,
  normalizeName,
  parseConfig,
  type Config,
  type DeckPin,
  type DeckPinOverlay,
  type DeckPins,
  type TokenRow,
} from '@mtgtoolbox/core';
import { idbGet, idbSet } from './idb.js';
import { SHOWCASE } from '../showcase.js';

/**
 * Where the config and deck edits live.
 *
 * The same UI runs in two situations: as a static site, where the only durable
 * storage is the browser's, and served by `mtgtoolbox serve`, where it should read
 * and write the very same files the CLI uses. Both satisfy this interface so no
 * view has to know which one it got.
 */
export interface DataStore {
  readonly kind: 'browser' | 'server' | 'readonly';
  /** Human-readable description of where data is being kept. */
  readonly location: string;
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  /** Pinned printings for every deck, keyed by deck id. */
  loadDeckPins(): Promise<AllDeckPins>;
  /** Pin one card in one deck, or clear it with `null`. */
  saveDeckPin(deckId: string, cardName: string, pin: DeckPin | null): Promise<void>;
  /** What saving a pin actually does here, for the UI to say out loud. */
  readonly pinTarget: string;
  /**
   * Whether decks can be renamed. Only the server can: the name lives in the
   * decklist file, and the browser has no way to write it back.
   */
  readonly canRenameDecks: boolean;
  /** Names given in the decklist files, keyed by deck id. */
  loadDeckNames(): Promise<DeckNames>;
  /** Rename one deck, or fall back to its filename with `null`. */
  saveDeckName(deckId: string, name: string | null): Promise<void>;
  /** Token rows saved since the site was built, keyed by deck id. */
  loadDeckTokens(): Promise<AllDeckTokens>;
  /** Replace one deck's Tokens section. */
  saveDeckTokens(deckId: string, rows: readonly TokenRow[]): Promise<void>;
}

/**
 * Deck id -> that deck's Tokens section.
 *
 * An absent deck keeps the section its bundled list was built with; a present
 * one, even empty, replaces it.
 */
export type AllDeckTokens = Record<string, TokenRow[]>;

/** Deck id -> the name its file gives, or null for none. */
export type DeckNames = Record<string, string | null>;

/** Deck id -> the pins layered over that deck's list. */
export type AllDeckPins = Record<string, DeckPinOverlay>;

/** Apply one pin to a map without mutating it. */
export function withPin(
  all: AllDeckPins,
  deckId: string,
  cardName: string,
  pin: DeckPin | null,
): AllDeckPins {
  const key = normalizeName(cardName);
  // A cleared pin is stored as null rather than dropped: with no server, the
  // decklist still names a printing, and only an explicit null overrides it.
  const deck: Record<string, DeckPin | null> = { ...(all[deckId] ?? {}) };
  deck[key] = pin;
  return { ...all, [deckId]: deck };
}

export class BrowserStore implements DataStore {
  readonly kind = 'browser' as const;
  readonly location = 'this browser';

  async loadConfig(): Promise<Config> {
    const stored = await idbGet<unknown>('data', 'config');
    if (!stored) return emptyConfig();
    // A hand-imported file can be malformed; fall back rather than trapping the
    // user in an app that will not boot.
    try {
      return parseConfig(stored.value);
    } catch {
      return emptyConfig();
    }
  }

  async saveConfig(config: Config): Promise<void> {
    await idbSet('data', 'config', config);
  }

  async loadDeckPins(): Promise<AllDeckPins> {
    const stored = await idbGet<AllDeckPins>('data', 'deckPins');
    return stored?.value ?? {};
  }

  async saveDeckPin(deckId: string, cardName: string, pin: DeckPin | null): Promise<void> {
    // Read-modify-write rather than holding a copy in the store: two tabs on
    // the same deck would otherwise overwrite each other's pins wholesale.
    const current = await this.loadDeckPins();
    await idbSet('data', 'deckPins', withPin(current, deckId, cardName, pin));
  }

  readonly pinTarget = 'this browser';
  readonly canRenameDecks = false;

  async loadDeckNames(): Promise<DeckNames> {
    return {};
  }

  async saveDeckName(): Promise<void> {
    throw new Error('decks can only be renamed with a local server running');
  }

  async loadDeckTokens(): Promise<AllDeckTokens> {
    const stored = await idbGet<AllDeckTokens>('data', 'deckTokens');
    return stored?.value ?? {};
  }

  async saveDeckTokens(deckId: string, rows: readonly TokenRow[]): Promise<void> {
    // Read-modify-write, for the same two-tabs reason as pins.
    const current = await this.loadDeckTokens();
    await idbSet('data', 'deckTokens', { ...current, [deckId]: [...rows] });
  }
}

/** Talks to the local API exposed by `mtgtoolbox serve`. */
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

  async loadConfig(): Promise<Config> {
    return parseConfig(await this.request('/api/config'));
  }

  async saveConfig(config: Config): Promise<void> {
    await this.request('/api/config', { method: 'PUT', body: JSON.stringify(config) });
  }

  async loadDeckPins(): Promise<AllDeckPins> {
    const body = await this.request<{ decks?: { id: string; pins: DeckPins }[] }>('/api/decks');
    return Object.fromEntries((body.decks ?? []).map((deck) => [deck.id, deck.pins]));
  }

  async saveDeckPin(deckId: string, cardName: string, pin: DeckPin | null): Promise<void> {
    await this.request(`/api/decks/${encodeURIComponent(deckId)}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ name: cardName, pin }),
    });
  }

  readonly pinTarget = 'the decklist files';
  readonly canRenameDecks = true;

  async loadDeckNames(): Promise<DeckNames> {
    const body = await this.request<{ decks?: { id: string; name?: string | null }[] }>('/api/decks');
    return Object.fromEntries((body.decks ?? []).map((deck) => [deck.id, deck.name ?? null]));
  }

  async saveDeckName(deckId: string, name: string | null): Promise<void> {
    await this.request(`/api/decks/${encodeURIComponent(deckId)}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  }

  async loadDeckTokens(): Promise<AllDeckTokens> {
    const body = await this.request<{ decks?: { id: string; tokens?: TokenRow[] }[] }>('/api/decks');
    // Every deck the server lists is overlaid: the file on disk is the truth,
    // and the copy in the build may predate an edit.
    return Object.fromEntries((body.decks ?? []).map((deck) => [deck.id, deck.tokens ?? []]));
  }

  async saveDeckTokens(deckId: string, rows: readonly TokenRow[]): Promise<void> {
    await this.request(`/api/decks/${encodeURIComponent(deckId)}/tokens`, {
      method: 'PUT',
      body: JSON.stringify({ rows }),
    });
  }
}

/**
 * A store that holds nothing and writes nowhere, for the published showcase.
 *
 * Every read answers empty and every write throws. Throwing rather than
 * quietly doing nothing is deliberate: a no-op write would let a view believe
 * it had saved something, and the bug would then be invisible in exactly the
 * build where it matters. In showcase mode no view offers a write at all, so
 * reaching one of these is a programming error and should look like one.
 */
export class ReadOnlyStore implements DataStore {
  readonly kind = 'readonly' as const;
  readonly location = 'nothing is saved';
  readonly pinTarget = 'nothing';
  readonly canRenameDecks = false;

  async loadConfig(): Promise<Config> {
    return emptyConfig();
  }

  async loadDeckPins(): Promise<AllDeckPins> {
    return {};
  }

  async saveConfig(): Promise<void> {
    throw new Error('this build is read-only');
  }

  async saveDeckPin(): Promise<void> {
    throw new Error('this build is read-only');
  }

  async loadDeckNames(): Promise<DeckNames> {
    return {};
  }

  async saveDeckName(): Promise<void> {
    throw new Error('this build is read-only');
  }

  async loadDeckTokens(): Promise<AllDeckTokens> {
    return {};
  }

  async saveDeckTokens(): Promise<void> {
    throw new Error('this build is read-only');
  }
}

/**
 * Pick a store by asking whether a local server is answering.
 *
 * The probe is deliberately short and failure-tolerant: a static deployment has
 * nothing listening, and that is the normal case rather than an error.
 */
export async function detectStore(timeoutMs = 800): Promise<DataStore> {
  // Not merely pointless in the published build but wrong: the probe is a
  // request to an origin that has no API, and the point of this mode is that
  // the page talks to nothing but Scryfall.
  if (SHOWCASE) return new ReadOnlyStore();

  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) {
      const body = (await response.json()) as { decksDir?: string };
      return new ServerStore(body.decksDir ?? 'local mtgtoolbox server');
    }
  } catch {
    // No server: fall through to browser storage.
  }
  return new BrowserStore();
}
