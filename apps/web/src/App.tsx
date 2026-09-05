import { useEffect, useMemo, useState } from 'react';
import type { Collection, Config } from '@mtgproxy/core';
import { detectStore, type DataStore } from './platform/store.js';
import { AppContext, type AppState } from './state.js';
import { initialSession, type PrintSession } from './session.js';
import { DecksView } from './views/DecksView.js';
import { PrintView } from './views/PrintView.js';
import { CollectionView } from './views/CollectionView.js';
import { PreferencesView } from './views/PreferencesView.js';
import { Spinner } from './components/ui.js';

const TABS = [
  { id: 'decks', label: 'Decks' },
  { id: 'print', label: 'Print' },
  { id: 'collection', label: 'Collection' },
  { id: 'preferences', label: 'Preferences' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [tab, setTab] = useState<TabId>('decks');
  // Held here so switching tabs does not discard a resolved decklist.
  const [session, setSession] = useState<PrintSession>(initialSession);
  const [store, setStore] = useState<DataStore | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The store is decided once at boot: whether a local server is answering
    // determines where everything is read from and written to for the session.
    void (async () => {
      const detected = await detectStore();
      const [loadedCollection, loadedConfig] = await Promise.all([
        detected.loadCollection(),
        detected.loadConfig(),
      ]);
      if (cancelled) return;
      setStore(detected);
      setCollection(loadedCollection);
      setConfig(loadedConfig);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const state = useMemo<AppState | null>(() => {
    if (!store || !collection || !config) return null;
    return {
      store,
      collection,
      config,
      // Persist first, then update state, so a failed write never leaves the UI
      // claiming a change that did not reach storage.
      saveCollection: async (next) => {
        await store.saveCollection(next);
        setCollection(next);
      },
      saveConfig: async (next) => {
        await store.saveConfig(next);
        setConfig(next);
      },
    };
  }, [store, collection, config]);

  if (!state) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Loading" />
      </div>
    );
  }

  return (
    <AppContext.Provider value={state}>
      <div className="min-h-dvh">
        <header className="border-b border-edge">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
            <h1 className="text-lg font-semibold tracking-tight">mtgproxy</h1>
            <nav className="flex gap-1">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    tab === item.id ? 'bg-accent text-surface' : 'hover:bg-edge/60'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <span className="ml-auto text-xs text-muted">
              {state.store.kind === 'server' ? 'Synced with' : 'Stored in'} {state.store.location}
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">
          {tab === 'decks' && (
            <DecksView
              onOpen={(deck) => {
                // Loading a deck replaces the whole working session: a stale
                // resolution or printing override from the previous deck would
                // silently apply to this one.
                setSession({ ...initialSession, text: deck.text });
                setTab('print');
              }}
            />
          )}
          {tab === 'print' && (
            <PrintView
              session={session}
              onChange={(patch) => setSession((current) => ({ ...current, ...patch }))}
            />
          )}
          {tab === 'collection' && <CollectionView />}
          {tab === 'preferences' && <PreferencesView />}
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted">
          Card data and images from{' '}
          <a className="underline" href="https://scryfall.com" target="_blank" rel="noreferrer">
            Scryfall
          </a>
          . Unaffiliated with Scryfall and with Wizards of the Coast. For personal playtest
          proxies.
        </footer>
      </div>
    </AppContext.Provider>
  );
}
