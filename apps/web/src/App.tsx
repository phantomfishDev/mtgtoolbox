import { useEffect, useMemo, useState } from 'react';
import { applyPins, type PrintedLedger, type Config } from '@mtgproxy/core';
import {
  detectStore,
  withPin,
  type AllDeckPins,
  type DataStore,
  type DeckNames,
} from './platform/store.js';
import { AppContext, type AppState } from './state.js';
import { initialSession, type PrintSession } from './session.js';
import { DecksView } from './views/DecksView.js';
import { DeckDetailView } from './views/DeckDetailView.js';
import { invalidateDeckIndex, titleFromId, type BundledDeck } from './decks.js';
import { PrintView } from './views/PrintView.js';
import { PrintedView } from './views/PrintedView.js';
import { PreferencesView } from './views/PreferencesView.js';
import { Spinner } from './components/ui.js';
import { APP_TITLE, SHOWCASE } from './showcase.js';

const ALL_TABS = [
  { id: 'decks', label: 'Decks' },
  { id: 'print', label: 'Print' },
  { id: 'printed', label: 'Printed' },
  { id: 'preferences', label: 'Preferences' },
] as const;

type TabId = (typeof ALL_TABS)[number]['id'];

/**
 * Printed and Preferences are the two tabs that write, and both of them
 * are about the person who owns the decks rather than the person reading the
 * page. They are the whole of the difference in the navigation; what is left
 * browses and prints, neither of which saves anything.
 */
const WRITING_TABS = new Set<TabId>(['printed', 'preferences']);

const TABS = SHOWCASE ? ALL_TABS.filter((tab) => !WRITING_TABS.has(tab.id)) : ALL_TABS;

export function App() {
  const [tab, setTab] = useState<TabId>('decks');
  // Held here so switching tabs does not discard a resolved decklist.
  const [session, setSession] = useState<PrintSession>(initialSession);
  /** The deck being browsed card by card; null shows the deck list. */
  const [viewing, setViewing] = useState<BundledDeck | null>(null);
  const [store, setStore] = useState<DataStore | null>(null);
  const [printed, setPrinted] = useState<PrintedLedger | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [deckPins, setDeckPins] = useState<AllDeckPins | null>(null);
  const [deckNames, setDeckNames] = useState<DeckNames>({});

  useEffect(() => {
    let cancelled = false;
    // The store is decided once at boot: whether a local server is answering
    // determines where everything is read from and written to for the session.
    void (async () => {
      const detected = await detectStore();
      const [loadedPrinted, loadedConfig, loadedPins, loadedNames] = await Promise.all([
        detected.loadPrinted(),
        detected.loadConfig(),
        // Pins must not be able to keep the app from booting: a deck with no
        // pins is the normal case, so an empty map is a fine answer.
        detected.loadDeckPins().catch(() => ({}) as AllDeckPins),
        // Likewise names: without them every deck still has the one it was built with.
        detected.loadDeckNames().catch(() => ({}) as DeckNames),
      ]);
      if (cancelled) return;
      setStore(detected);
      setPrinted(loadedPrinted);
      setConfig(loadedConfig);
      setDeckPins(loadedPins);
      setDeckNames(loadedNames);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const state = useMemo<AppState | null>(() => {
    if (!store || !printed || !config || !deckPins) return null;
    return {
      store,
      printed,
      config,
      deckPins,
      // Persist first, then update state, so a failed write never leaves the UI
      // claiming a change that did not reach storage.
      savePrinted: async (next) => {
        await store.savePrinted(next);
        setPrinted(next);
      },
      saveConfig: async (next) => {
        await store.saveConfig(next);
        setConfig(next);
      },
      saveDeckPin: async (deckId, cardName, pin) => {
        await store.saveDeckPin(deckId, cardName, pin);
        // The server has just rewritten this deck's index entry to match.
        if (store.kind === 'server') invalidateDeckIndex();
        setDeckPins((current) => withPin(current ?? {}, deckId, cardName, pin));
      },
      deckName: (deck) => {
        // Only ids the server reported are overlaid; an absent key means the
        // build's own name stands, while null means the file names none.
        if (!(deck.id in deckNames)) return deck.name;
        return deckNames[deck.id] ?? titleFromId(deck.id);
      },
      saveDeckName: async (deckId, name) => {
        const clean = name?.trim() || null;
        await store.saveDeckName(deckId, clean);
        setDeckNames((current) => ({ ...current, [deckId]: clean }));
      },
    };
  }, [store, printed, config, deckPins, deckNames]);

  // Loading a deck replaces the whole working session: a stale resolution or
  // printing override from the previous deck would silently apply to this one.
  //
  // Pins go with it. They belong to the deck rather than to the screen that set
  // them, so printing has to use the printings the deck browser just showed —
  // otherwise choosing an artwork and then printing would quietly ignore it.
  // With `mtgproxy serve` the file on disk already says this and re-applying is
  // a no-op, which is what keeps the two modes identical.
  const openForPrinting = (deck: BundledDeck): void => {
    setSession({
      ...initialSession,
      text: applyPins(deck.text, deckPins?.[deck.id] ?? {}),
      deckId: deck.id,
    });
    setTab('print');
  };

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
            <h1 className="text-lg font-semibold tracking-tight">{APP_TITLE}</h1>
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
            {!SHOWCASE && (
              <span className="ml-auto text-xs text-muted">
                {state.store.kind === 'server' ? 'Synced with' : 'Stored in'} {state.store.location}
              </span>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">
          {tab === 'decks' &&
            (viewing ? (
              <DeckDetailView
                deck={viewing}
                onBack={() => setViewing(null)}
                onPrint={openForPrinting}
              />
            ) : (
              <DecksView onView={setViewing} onPrint={openForPrinting} />
            ))}
          {tab === 'print' && (
            <PrintView
              session={session}
              onChange={(patch) => setSession((current) => ({ ...current, ...patch }))}
            />
          )}
          {tab === 'printed' && <PrintedView />}
          {tab === 'preferences' && <PreferencesView />}
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted">
          Card data and images from{' '}
          <a className="underline" href="https://scryfall.com" target="_blank" rel="noreferrer">
            Scryfall
          </a>
          . Unaffiliated with Scryfall. {APP_TITLE} is unofficial Fan Content permitted under
          the{' '}
          <a
            className="underline"
            href="https://company.wizards.com/en/legal/fancontentpolicy"
            target="_blank"
            rel="noreferrer"
          >
            Fan Content Policy
          </a>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of
          Wizards of the Coast. &copy;Wizards of the Coast LLC.
        </footer>
      </div>
    </AppContext.Provider>
  );
}
