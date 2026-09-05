import { useMemo, useState } from 'react';
import { BUNDLED_DECKS, type BundledDeck } from '../decks.js';
import { Badge, Button, Panel } from '../components/ui.js';

/**
 * Browse the decklists bundled with the repository and send one to the printer.
 *
 * Deliberately does no network work: everything shown here comes from parsing
 * the local files, so the list is instant and usable offline. Card images and
 * printings are only fetched once a deck is actually opened.
 */
export function DecksView({
  onView,
  onPrint,
}: {
  onView: (deck: BundledDeck) => void;
  onPrint: (deck: BundledDeck) => void;
}) {
  const [query, setQuery] = useState('');

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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
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
  onView,
  onPrint,
}: {
  deck: BundledDeck;
  onView: () => void;
  onPrint: () => void;
}) {
  // A Commander deck is exactly 100; flag anything else rather than hiding it.
  const complete = deck.cardCount === 100;

  return (
    <Panel className="flex flex-col gap-3">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight">{deck.name}</h3>
          <Badge tone={complete ? 'good' : 'warn'}>{deck.cardCount}</Badge>
        </div>
        {deck.commanders.length > 0 ? (
          <p className="mt-1 text-sm">
            <span className="text-muted">Commander </span>
            <span className="font-medium">{deck.commanders.join(' / ')}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted italic">No commander declared</p>
        )}
      </div>

      {deck.note && <p className="line-clamp-3 text-xs text-muted">{deck.note}</p>}

      <div className="mt-auto flex items-center gap-2">
        <Button variant="primary" onClick={onView}>
          View cards
        </Button>
        <Button onClick={onPrint}>Print</Button>
      </div>
    </Panel>
  );
}
