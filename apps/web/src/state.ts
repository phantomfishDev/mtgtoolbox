import { createContext, useContext } from 'react';
import type { Collection, Config, DeckPin } from '@mtgproxy/core';
import type { AllDeckPins, DataStore } from './platform/store.js';

/** App-wide data, provided once at the root so views never build their own store. */
export interface AppState {
  store: DataStore;
  collection: Collection;
  config: Config;
  /** Pinned printings for every deck, keyed by deck id. */
  deckPins: AllDeckPins;
  saveCollection: (collection: Collection) => Promise<void>;
  saveConfig: (config: Config) => Promise<void>;
  /** Pin a printing for one card in one deck, or clear it with `null`. */
  saveDeckPin: (deckId: string, cardName: string, pin: DeckPin | null) => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside the app provider');
  return value;
}
