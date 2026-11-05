import { createContext, useContext } from 'react';
import type { PrintedLedger, Config, DeckPin } from '@mtgproxy/core';
import type { AllDeckPins, DataStore } from './platform/store.js';
import type { BundledDeck } from './decks.js';

/** App-wide data, provided once at the root so views never build their own store. */
export interface AppState {
  store: DataStore;
  printed: PrintedLedger;
  config: Config;
  /** Pinned printings for every deck, keyed by deck id. */
  deckPins: AllDeckPins;
  savePrinted: (ledger: PrintedLedger) => Promise<void>;
  saveConfig: (config: Config) => Promise<void>;
  /** Pin a printing for one card in one deck, or clear it with `null`. */
  saveDeckPin: (deckId: string, cardName: string, pin: DeckPin | null) => Promise<void>;
  /**
   * The name to show for a deck.
   *
   * Bundled decks carry the name their file had at build time; a rename made
   * since — or a file edited under `mtgproxy serve` after the site was built —
   * is layered over that here, so every view agrees on it.
   */
  deckName: (deck: BundledDeck) => string;
  /** Rename a deck, or reset it to its filename with `null`. */
  saveDeckName: (deckId: string, name: string | null) => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside the app provider');
  return value;
}
