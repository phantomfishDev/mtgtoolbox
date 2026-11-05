import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_PROFILE,
  addFoundTokens,
  findTokens,
  lookupTokenRows,
  readTokenRows,
  type ScryfallCard,
  type TokenRow,
} from '@mtgproxy/core';
import { getClient } from '../platform/client.js';
import { useApp } from '../state.js';
import { activeProfile } from '../resolve.js';
import { PrintingPicker } from './PrintingPicker.js';
import { SHOWCASE } from '../showcase.js';
import { Button, Panel, Spinner } from './ui.js';

/** How many of a token a search adds when it finds one. */
const DEFAULT_QUANTITY = 4;

function printingKey(set: string | undefined, number: string | undefined): string {
  return `${(set ?? '').toLowerCase()}|${(number ?? '').toLowerCase()}`;
}

function sameRows(a: readonly TokenRow[], b: readonly TokenRow[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, index) =>
        row.quantity === b[index]?.quantity &&
        printingKey(row.set, row.collectorNumber) ===
          printingKey(b[index]?.set, b[index]?.collectorNumber) &&
        row.name === b[index]?.name,
    )
  );
}

/**
 * A deck's tokens: which ones it makes, and how many of each to print.
 *
 * Counts and art are edited as a draft and saved together, because each save rewrites
 * the decklist (under `mtgproxy serve`) and every click of a stepper would
 * otherwise be a file write. A count of 0 is kept rather than deleted, so the
 * next search does not offer the same token again.
 */
export function TokenPanel({
  deckId,
  text,
  cards,
  onPrint,
}: {
  deckId: string;
  /** The deck's current list, as the print view would receive it. */
  text: string;
  /** The deck's resolved cards, which are what a search reads `all_parts` from. */
  cards: readonly ScryfallCard[] | null;
  onPrint: () => void;
}) {
  const { saveDeckTokens, store, config } = useApp();
  const profile = useMemo(() => activeProfile(config, DEFAULT_PROFILE), [config]);
  /** The row whose art is being chosen; null when the picker is shut. */
  const [picking, setPicking] = useState<number | null>(null);
  const saved = useMemo(() => readTokenRows(text), [text]);
  const [draft, setDraft] = useState<TokenRow[] | null>(null);
  /** Printings by set and number, for the images; filled as rows appear. */
  const [printings, setPrintings] = useState<Map<string, ScryfallCard>>(new Map());
  /** Which deck cards make each token, known only after a search. */
  const [makers, setMakers] = useState<Map<string, string[]>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = draft ?? saved;
  const dirty = draft !== null && !sameRows(draft, saved);
  const total = saved.reduce((sum, row) => sum + row.quantity, 0);

  // A different deck starts clean.
  useEffect(() => {
    setDraft(null);
    setMakers(new Map());
    setMessage(null);
    setError(null);
  }, [deckId]);

  /** Printings already asked for, so one Scryfall does not know is not asked for forever. */
  const requested = useRef(new Set<string>());

  // Look up any pinned printing not yet in hand: one request, cached after.
  useEffect(() => {
    const missing = rows.filter((row) => {
      const key = printingKey(row.set, row.collectorNumber);
      return row.set && row.collectorNumber && !printings.has(key) && !requested.current.has(key);
    });
    if (missing.length === 0) return;
    for (const row of missing) requested.current.add(printingKey(row.set, row.collectorNumber));
    lookupTokenRows(missing, getClient())
      .then((found) => {
        setPrintings((current) => {
          const next = new Map(current);
          for (const card of found) if (card) next.set(printingKey(card.set, card.collector_number), card);
          return next;
        });
      })
      .catch(() => {
        // Images are a nicety; the rows still edit and save without them.
      });
  }, [rows, printings]);

  const search = async (): Promise<void> => {
    if (!cards) return;
    setBusy('Looking for tokens');
    setError(null);
    setMessage(null);
    try {
      const client = getClient();
      const found = await findTokens(cards, client);
      const current = draft ?? saved;
      const merged = addFoundTokens(current, await lookupTokenRows(current, client), found, DEFAULT_QUANTITY);
      setPrintings((known) => {
        const next = new Map(known);
        for (const { card } of found) next.set(printingKey(card.set, card.collector_number), card);
        return next;
      });
      setMakers(
        new Map(found.map(({ card, madeBy }) => [printingKey(card.set, card.collector_number), madeBy])),
      );
      setDraft(merged.rows);
      setMessage(
        found.length === 0
          ? 'No card in this deck makes a token.'
          : merged.added.length === 0
            ? `All ${found.length} tokens this deck makes are already listed.`
            : `Found ${merged.added.length} new token${merged.added.length === 1 ? '' : 's'}, added at ${DEFAULT_QUANTITY} each. Save to keep them.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const setQuantity = (index: number, quantity: number): void => {
    const clean = Number.isFinite(quantity) ? Math.max(0, Math.min(99, Math.round(quantity))) : 0;
    setDraft(rows.map((row, i) => (i === index ? { ...row, quantity: clean } : row)));
  };

  /** Point a row at another printing of its token; saved with the counts. */
  const choosePrinting = (index: number, card: ScryfallCard): void => {
    setPrintings((known) => new Map(known).set(printingKey(card.set, card.collector_number), card));
    setDraft(
      rows.map((row, i) =>
        i === index ? { ...row, set: card.set, collectorNumber: card.collector_number } : row,
      ),
    );
    setPicking(null);
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    setBusy('Saving');
    setError(null);
    try {
      await saveDeckTokens(deckId, draft);
      setDraft(null);
      setMessage(`Saved to ${store.pinTarget}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const editable = !SHOWCASE;

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Tokens{' '}
          <span className="font-normal text-muted">
            ({total} to print{rows.length > 0 ? `, ${rows.length} kinds` : ''})
          </span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button onClick={() => void search()} disabled={!cards || busy !== null}>
              Find tokens
            </Button>
          )}
          {dirty && (
            <>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy !== null}>
                Discard
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy !== null}>
                Save changes
              </Button>
            </>
          )}
          <Button
            onClick={onPrint}
            disabled={total === 0 || dirty}
            title={dirty ? 'Save your changes first' : 'Open the print view with only the tokens'}
          >
            Print tokens
          </Button>
        </div>
      </div>

      {busy && <Spinner label={busy} />}
      {message && !busy && <p className="mb-2 text-xs text-muted">{message}</p>}
      {error && <p className="mb-2 text-xs text-amber-600">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          {editable
            ? 'No tokens listed yet. Find tokens reads the cards in this deck and lists what they make.'
            : 'This deck lists no tokens.'}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {rows.map((row, index) => {
            const key = printingKey(row.set, row.collectorNumber);
            const card = printings.get(key);
            const image = card?.image_uris?.normal ?? card?.card_faces?.[0]?.image_uris?.normal;
            const madeBy = makers.get(key);
            const stats = card?.power ? ` ${card.power}/${card.toughness}` : '';
            return (
              <div key={`${key}-${row.name}-${index}`} className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={!editable || !card}
                  onClick={() => setPicking(index)}
                  title={[
                    `${row.name}${stats}`,
                    card?.oracle_text,
                    madeBy && `Made by ${madeBy.join(', ')}`,
                    editable && card && 'Click to change the art',
                  ]
                    .filter(Boolean)
                    .join('\n')}
                  className={`relative overflow-hidden rounded-lg border border-edge transition enabled:hover:border-accent ${row.quantity === 0 ? 'opacity-40' : ''}`}
                >
                  {image ? (
                    <img src={image} alt={row.name} loading="lazy" className="aspect-[63/88] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[63/88] w-full items-center justify-center bg-edge p-1 text-center text-[10px]">
                      {row.name}
                    </div>
                  )}
                </button>
                <p className="truncate text-[11px] text-muted" title={`${row.name}${stats}`}>
                  {row.name}
                  {stats}
                </p>
                {editable ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`One fewer ${row.name}`}
                      onClick={() => setQuantity(index, row.quantity - 1)}
                      disabled={row.quantity === 0}
                      className="size-6 rounded border border-edge text-sm hover:border-accent disabled:opacity-40"
                    >
                      &minus;
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={row.quantity}
                      onChange={(event) => setQuantity(index, Number.parseInt(event.target.value, 10))}
                      aria-label={`How many ${row.name} to print`}
                      className="w-10 rounded border border-edge bg-surface px-1 py-0.5 text-center text-xs"
                    />
                    <button
                      type="button"
                      aria-label={`One more ${row.name}`}
                      onClick={() => setQuantity(index, row.quantity + 1)}
                      className="size-6 rounded border border-edge text-sm hover:border-accent"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted">{row.quantity}x</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editable && rows.some((row) => row.quantity === 0) && (
        <p className="mt-3 text-xs text-muted">
          Faded tokens are set to 0: they stay listed so Find tokens does not add them back, and
          nothing prints for them.
        </p>
      )}
      {picking !== null && editable && (() => {
        const row = rows[picking];
        const card = row && printings.get(printingKey(row.set, row.collectorNumber));
        return card ? (
          <PrintingPicker
            card={card}
            profile={profile}
            scope={row.quantity > 1 ? `all ${row.quantity} copies` : null}
            onPick={(chosen) => choosePrinting(picking, chosen)}
            onClose={() => setPicking(null)}
          />
        ) : null;
      })()}
    </Panel>
  );
}
