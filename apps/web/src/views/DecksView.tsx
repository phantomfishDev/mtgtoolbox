import { useEffect, useMemo, useState } from 'react';
import { type DeckIndexEntry } from '@mtgtoolbox/core';
import { BUNDLED_DECKS, DECK_OWNERS, loadDeckIndex, type BundledDeck } from '../decks.js';
import { useApp } from '../state.js';
import { ColorPips } from '../components/ColorPips.js';
import { Badge, Button, Panel } from '../components/ui.js';
import { SHOWCASE } from '../showcase.js';

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
  const { deckName, store } = useApp();
  const [query, setQuery] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [index, setIndex] = useState<Map<string, DeckIndexEntry> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDeckIndex(store.kind === 'server').then((loaded) => {
      if (cancelled || !loaded) return;
      setIndex(new Map(loaded.decks.map((deck) => [deck.id, deck])));
    });
    return () => {
      cancelled = true;
    };
  }, [store.kind]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = BUNDLED_DECKS.filter((deck) => {
      if (owner !== null && deck.owner !== owner) return false;
      if (!needle) return true;
      return (
        deckName(deck).toLowerCase().includes(needle) ||
        (deck.owner?.toLowerCase().includes(needle) ?? false) ||
        deck.commanders.some((name) => name.toLowerCase().includes(needle)) ||
        deck.entries.some((entry) => entry.name.toLowerCase().includes(needle))
      );
    });
    // Re-sorted because a rename can move a deck along the shelf.
    return matching.sort((a, b) => deckName(a).localeCompare(deckName(b)));
  }, [query, owner, deckName]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Decks</h2>
          <p className="text-sm text-muted">
            {BUNDLED_DECKS.length} decks on the shelf, ready to play. Click one to see every
            card in it.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search decks or cards"
          className="w-64 rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
        />
      </div>

      {DECK_OWNERS.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Whose deck:</span>
          <OwnerChip label="Everyone" active={owner === null} onClick={() => setOwner(null)} />
          {DECK_OWNERS.map((name) => (
            <OwnerChip
              key={name}
              label={name}
              active={owner === name}
              onClick={() => setOwner(owner === name ? null : name)}
            />
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted">
            {query.trim()
              ? `Nothing matching \u201c${query}\u201d`
              : 'No decks here'}
            {owner !== null && ` among ${owner}\u2019s decks`}.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              summary={index?.get(deck.id)}
              onView={() => onView(deck)}
              onPrint={() => onPrint(deck)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OwnerChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 transition ${
        active
          ? 'border-accent bg-accent/10 font-medium text-accent'
          : 'border-edge text-muted hover:border-accent hover:text-accent'
      }`}
    >
      {label}
    </button>
  );
}

function DeckCard({
  deck,
  summary,
  onView,
  onPrint,
}: {
  deck: BundledDeck;
  summary: DeckIndexEntry | undefined;
  onView: () => void;
  onPrint: () => void;
}) {
  // A Commander deck is exactly 100; flag anything else rather than hiding it.
  const complete = deck.cardCount === 100;
  const commanderImage = summary?.commanders.find((c) => c.image)?.image;
  const name = useApp().deckName(deck);

  return (
    <Panel className="flex gap-3">
      <button
        type="button"
        onClick={onView}
        title={`View ${name}`}
        className="shrink-0 overflow-hidden rounded-md border border-edge transition hover:border-accent"
      >
        {commanderImage ? (
          <img
            src={commanderImage}
            alt={summary?.commanders[0]?.name ?? name}
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
          <h3 className="truncate font-semibold leading-tight">{name}</h3>
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
          <span className="tabular-nums text-muted">{deck.cardCount} cards</span>
          {!complete && <Badge tone="warn">{deck.cardCount} cards</Badge>}
          {deck.owner && (
            <span className="text-muted" title={`This deck belongs to ${deck.owner}`}>
              &middot; {deck.owner}&rsquo;s
            </span>
          )}
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
