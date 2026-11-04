import {
  emptyLedger,
  emptyConfig,
  normalizeName,
  parsePrinted,
  parseConfig,
  type PrintedLedger,
  type Config,
  type DeckPin,
  type DeckPinOverlay,
  type DeckPins,
} from '@mtgproxy/core';
import { idbGet, idbSet } from './idb.js';

/**
 * Where the printed ledger and config live.
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
  loadPrinted(): Promise<PrintedLedger>;
  savePrinted(ledger: PrintedLedger): Promise<void>;
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  /** Pinned printings for every deck, keyed by deck id. */
  loadDeckPins(): Promise<AllDeckPins>;
  /** Pin one card in one deck, or clear it with `null`. */
  saveDeckPin(deckId: string, cardName: string, pin: DeckPin | null): Promise<void>;
  /** What saving a pin actually does here, for the UI to say out loud. */
  readonly pinTarget: string;
}

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

  async loadPrinted(): Promise<PrintedLedger> {
    const stored = await idbGet<unknown>('data', 'printed');
    if (!stored) return emptyLedger();
    // A hand-imported file can be malformed; fall back rather than trapping the
    // user in an app that will not boot.
    try {
      return parsePrinted(stored.value);
    } catch {
      return emptyLedger();
    }
  }

  async savePrinted(ledger: PrintedLedger): Promise<void> {
    await idbSet('data', 'printed', ledger);
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
}

/** Talks to the local API exposed by `mtgproxy serve`. */
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

  async loadPrinted(): Promise<PrintedLedger> {
    return parsePrinted(await this.request('/api/printed'));
  }

  async savePrinted(ledger: PrintedLedger): Promise<void> {
    await this.request('/api/printed', { method: 'PUT', body: JSON.stringify(ledger) });
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
      const body = (await response.json()) as { printedPath?: string };
      return new ServerStore(body.printedPath ?? 'local mtgproxy server');
    }
  } catch {
    // No server: fall through to browser storage.
  }
  return new BrowserStore();
}
