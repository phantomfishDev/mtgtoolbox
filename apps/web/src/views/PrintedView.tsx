import { useMemo, useState } from 'react';
import { emptyLedger, entryKey, sortEntries } from '@mtgproxy/core';
import { useApp } from '../state.js';
import { Badge, Button, Panel } from '../components/ui.js';

/**
 * Browse the ledger of cards already printed.
 *
 * Read-mostly on purpose. Entries arrive from a print run that recorded itself,
 * so the only edits offered here are the corrective ones: drop a row that did
 * not actually come out of the printer, or start over.
 */
export function PrintedView() {
  const { printed, savePrinted, store } = useApp();
  const [query, setQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const stats = useMemo(() => {
    const cards = printed.cards.reduce((sum, entry) => sum + entry.quantity, 0);
    const names = new Set(printed.cards.map((entry) => entry.name.toLowerCase())).size;
    return { cards, names, printings: printed.cards.length };
  }, [printed]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? printed.cards.filter(
          (entry) =>
            entry.name.toLowerCase().includes(needle) ||
            entry.note?.toLowerCase().includes(needle),
        )
      : printed.cards;
    return sortEntries(rows);
  }, [printed, query]);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Printed</h2>
            <p className="text-sm text-muted">
              {stats.cards} cards across {stats.printings} printings, {stats.names} distinct names.
            </p>
          </div>
          <p className="text-xs text-muted">{store.location}</p>
        </div>
        <p className="mt-3 text-sm text-muted">
          A deck print set to <span className="font-medium">unprinted only</span> skips everything
          listed here. Matching is per printing, so choosing a different art for a card you have
          already printed counts as a new card to print.
        </p>
      </Panel>

      <Panel>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or deck"
            className="w-56 rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
          />
          {printed.cards.length > 0 &&
            (confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">Forget all {stats.cards} cards?</span>
                <Button
                  onClick={() => {
                    setConfirmClear(false);
                    void savePrinted(emptyLedger());
                  }}
                >
                  Yes, clear it
                </Button>
                <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
              </div>
            ) : (
              <Button onClick={() => setConfirmClear(true)}>Clear ledger</Button>
            ))}
        </div>

        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {printed.cards.length === 0
              ? 'Nothing printed yet. Print a deck with "record what was printed" on and it shows up here.'
              : `Nothing matching "${query}".`}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-edge">
                <th className="pb-2 font-medium">Qty</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Printing</th>
                <th className="pb-2 font-medium">From</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entryKey(entry)} className="border-b border-edge/50">
                  <td className="py-1.5 tabular-nums">{entry.quantity}</td>
                  <td className="py-1.5">
                    {entry.name}
                    {entry.language && (
                      <span className="ml-2">
                        <Badge>{entry.language}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-muted">
                    {entry.set.toUpperCase()} {entry.collectorNumber}
                  </td>
                  <td className="py-1.5 text-muted">{entry.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
