import { useEffect, useMemo, useState } from 'react';
import { diffDeck, indexCardsToResolved, type DeckIndexEntry } from '@mtgproxy/core';
import { BUNDLED_DECKS, loadDeckIndex, type BundledDeck } from '../decks.js';
import { useApp } from '../state.js';
import { ColorPips } from '../components/ColorPips.js';
import { Badge, Button, Panel } from '../components/ui.js';

/**
 * Browse the decklists bundled with the repository and send one to the printer.
 *
 * Everything shown comes from the deck index rather than from resolving each
 * deck: doing the latter for eight decks would be a megabyte of card data
 * before the page could render. Card images are the only network traffic, and
 * they are the point of the page.
 */
export function DecksView({
  onView,
  onPrint,
}: {
  onView: (deck: BundledDeck) => void;
  onPrint: (deck: BundledDeck) => void;
}) {
  const { collection } = useApp();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<Map<string, DeckIndexEntry> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDeckIndex().then((loaded) => {
      if (cancelled || !loaded) return;
      setIndex(new Map(loaded.decks.map((deck) => [deck.id, deck])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Owned counts, using the same diff the deck view runs so the two can never
   * disagree about how many cards you already have.
   */
  const owned = useMemo(() => {
    if (!index) return null;
    const counts = new Map<string, { owned: number; needed: number }>();
    for (const [id, entry] of index) {
      const diff = diffDeck(indexCardsToResolved(entry.cards), collection, { assumeBasics: true });
      counts.set(id, { owned: diff.totalOwned, needed: diff.totalNeeded });
    }
    return counts;
  }, [index, collection]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return BUNDLED_DECKS;
    return BUNDLED_DECKS.filter(
      (deck) =>
        deck.name.toLowerCase().includes(needle) ||
        deck.commanders.some((name) => name.toLowerCase().includes(needle)) ||
        deck.entries.some((entry) => entry.name.toLowerCase().includes(needle)),
    );
  }, [query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Decks</h2>
          <p className="text-sm text-muted">
            {BUNDLED_DECKS.length} decklists from the project&rsquo;s{' '}
            <code className="rounded bg-edge px-1">examples/</code> directory. Drop a{' '}
            <code className="rounded bg-edge px-1">.txt</code> in there and it shows up here.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search decks or cards"
          className="w-64 rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
        />
      </div>

      {visible.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted">Nothing matching &ldquo;{query}&rdquo;.</p>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              summary={index?.get(deck.id)}
              owned={owned?.get(deck.id)}
              onView={() => onView(deck)}
              onPrint={() => onPrint(deck)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeckCard({
  deck,
  summary,
  owned,
  onView,
  onPrint,
}: {
  deck: BundledDeck;
  summary: DeckIndexEntry | undefined;
  owned: { owned: number; needed: number } | undefined;
  onView: () => void;
  onPrint: () => void;
}) {
  // A Commander deck is exactly 100; flag anything else rather than hiding it.
  const complete = deck.cardCount === 100;
  const commanderImage = summary?.commanders.find((c) => c.image)?.image;

  return (
    <Panel className="flex gap-3">
      <button
        type="button"
        onClick={onView}
        title={`View ${deck.name}`}
        className="shrink-0 overflow-hidden rounded-md border border-edge transition hover:border-accent"
      >
        {commanderImage ? (
          <img
            src={commanderImage}
            alt={summary?.commanders[0]?.name ?? deck.name}
            loading="lazy"
            className="aspect-[63/88] w-20 object-cover"
          />
        ) : (
          <div className="flex aspect-[63/88] w-20 items-center justify-center bg-edge p-1 text-center text-[10px] text-muted">
            no commander
          </div>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold leading-tight">{deck.name}</h3>
          {summary && (
            <Badge tone={summary.bracket >= 4 ? 'warn' : 'neutral'}>B{summary.bracket}</Badge>
          )}
        </div>

        {deck.commanders.length > 0 ? (
          <p className="truncate text-xs text-muted" title={deck.commanders.join(' / ')}>
            {deck.commanders.join(' / ')}
          </p>
        ) : (
          <p className="text-xs italic text-muted">No commander declared</p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {summary && <ColorPips colors={summary.colorIdentity} />}
          {summary && <span className="text-xs text-muted">{summary.bracketName}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {owned ? (
            <span className="tabular-nums" title="Cards you already own, of the whole deck">
              <span className="font-medium">{owned.owned}</span>
              <span className="text-muted">/{owned.needed} owned</span>
            </span>
          ) : (
            <span className="tabular-nums text-muted">{deck.cardCount} cards</span>
          )}
          {!complete && <Badge tone="warn">{deck.cardCount} cards</Badge>}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button variant="primary" onClick={onView}>
            View cards
          </Button>
          <Button onClick={onPrint}>Print</Button>
        </div>
      </div>
    </Panel>
  );
}
