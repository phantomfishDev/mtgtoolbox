import { createContext, useContext } from 'react';
import type { Collection, Config } from '@mtgproxy/core';
import type { DataStore } from './platform/store.js';

/** App-wide data, provided once at the root so views never build their own store. */
export interface AppState {
  store: DataStore;
  collection: Collection;
  config: Config;
  saveCollection: (collection: Collection) => Promise<void>;
  saveConfig: (config: Config) => Promise<void>;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside the app provider');
  return value;
}
