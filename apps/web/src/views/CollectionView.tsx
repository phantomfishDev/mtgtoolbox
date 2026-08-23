import { useMemo, useRef, useState } from 'react';
import {
  addEntry,
  collectionStats,
  entryFromCard,
  parseCollection,
  removeEntry,
  searchCollection,
  sortEntries,
  type CollectionEntry,
  type Finish,
} from '@mtgproxy/core';
import { getClient } from '../platform/client.js';
import { useApp } from '../state.js';
import { Badge, Button, Field, Panel, Select, Spinner } from '../components/ui.js';

/** Add, browse and move the collection in and out of the app. */
export function CollectionView() {
  const { collection, saveCollection, store } = useApp();
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => collectionStats(collection), [collection]);
  const visible = useMemo(
    () => sortEntries(query.trim() ? searchCollection(collection, query) : collection.cards),
    [collection, query],
  );

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      // Resolve through Scryfall so the stored name and printing are canonical
      // rather than however it was typed.
      const card = await getClient().named(name);
      if (!card) throw new Error(`No card found matching "${name}".`);
      await saveCollection(addEntry(collection, entryFromCard(card, { quantity, finish })));
      setMessage(`Added ${quantity} x ${card.name} (${card.set.toUpperCase()})`);
      setName('');
      setQuantity(1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: CollectionEntry, count: number) {
    await saveCollection(removeEntry(collection, entry, count).collection);
  }

  function exportFile() {
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'collection.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    setMessage(null);
    try {
      // Validate before replacing: a bad import must not destroy what is there.
      const parsed = parseCollection(JSON.parse(await file.text()));
      await saveCollection(parsed);
      setMessage(`Imported ${parsed.cards.length} entries`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="mb-3 font-semibold">Add a card</h2>
          <div className="flex flex-col gap-3">
            <Field label="Card name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void add()}
                placeholder="Sol Ring"
                className="rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))}
                  className="rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Finish">
                <Select
                  value={finish}
                  onChange={setFinish}
                  options={[
                    { value: 'nonfoil', label: 'Nonfoil' },
                    { value: 'foil', label: 'Foil' },
                    { value: 'etched', label: 'Etched' },
                  ]}
                />
              </Field>
            </div>
            <Button variant="primary" onClick={add} disabled={busy || !name.trim()}>
              Add
            </Button>
            {busy && <Spinner label="Looking up card" />}
            {message && <p className="text-xs text-muted">{message}</p>}
          </div>
        </Panel>

        <Panel>
          <h2 className="mb-2 font-semibold">Summary</h2>
          <dl className="space-y-1 text-sm">
            <Row label="Cards" value={String(stats.totalCards)} />
            <Row label="Distinct names" value={String(stats.distinctNames)} />
            <Row label="Printings" value={String(stats.distinctPrintings)} />
            <Row label="Stored in" value={store.location} />
          </dl>
          <div className="mt-3 flex gap-2">
            <Button onClick={exportFile}>Export</Button>
            <Button onClick={() => fileInput.current?.click()}>Import</Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = '';
              }}
            />
          </div>
          {store.kind === 'browser' && (
            <p className="mt-2 text-xs text-muted">
              Stored in this browser only. Export to keep a copy, or run{' '}
              <code className="rounded bg-edge px-1">mtgproxy serve</code> to share the CLI&rsquo;s
              file.
            </p>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Your cards</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or tag"
            className="w-48 rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
          />
        </div>

        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {collection.cards.length === 0
              ? 'Nothing here yet. Add a card to get started.'
              : `Nothing matching "${query}".`}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-edge">
                <th className="pb-2 font-medium">Qty</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Printing</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={`${entry.name}|${entry.set}|${entry.collectorNumber}|${entry.finish}`} className="border-b border-edge/50">
                  <td className="py-1.5 tabular-nums">{entry.quantity}</td>
                  <td className="py-1.5">
                    {entry.name}
                    {entry.finish !== 'nonfoil' && (
                      <span className="ml-2">
                        <Badge>{entry.finish}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-muted">
                    {entry.set.toUpperCase()} {entry.collectorNumber}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(entry, 1)}
                      className="px-1 text-muted hover:text-accent"
                      title="Remove one copy"
                    >
                      &minus;
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(entry, Number.POSITIVE_INFINITY)}
                      className="px-1 text-muted hover:text-accent"
                      title="Remove all copies"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
