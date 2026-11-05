import { useEffect, useState } from 'react';
import {
  comparePrintings,
  isBasicLand,
  isTokenCard,
  scorePrinting,
  tokenPrintings,
  type PreferenceProfile,
  type PrintingScore,
  type ScryfallCard,
} from '@mtgtoolbox/core';
import { getClient } from '../platform/client.js';
import { Badge, Button, Spinner } from './ui.js';

/**
 * Browse every printing of one card and pick a different one.
 *
 * The list is ranked by the same scorer the CLI uses, so what appears at the top
 * here is exactly what a print run would have chosen on its own — the picker is
 * an override, not a separate opinion.
 */
export function PrintingPicker({
  card,
  scope,
  profile,
    onPick,
  onClose,
}: {
  card: ScryfallCard;
  /** What the choice applies to, when the deck runs more than one copy. */
  scope?: string | null;
  profile: PreferenceProfile;
  onPick: (card: ScryfallCard) => void;
  onClose: () => void;
}) {
  const [ranked, setRanked] = useState<PrintingScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRanked(null);
    setError(null);

    // Tokens need their own search: an ordinary one hides them, and their
    // names are shared by tokens that are not interchangeable.
    const client = getClient();
    (isTokenCard(card) ? tokenPrintings(card, client) : client.prints(card.name))
      .then((candidates) => {
        if (cancelled) return;
        const isBasic = isBasicLand(candidates[0] ?? card);
        setRanked(
          candidates
            .map((candidate) => scorePrinting(candidate, profile, { isBasic }))
            .sort(comparePrintings),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [card.name, profile, card]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-edge bg-surface"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Choose a printing of ${card.name}`}
      >
        <header className="flex items-center justify-between border-b border-edge p-4">
          <div>
            <h2 className="font-semibold">{card.name}</h2>
            <p className="text-xs text-muted">
              {ranked ? `${ranked.length} printings, ranked by your preferences` : 'loading...'}
              {scope ? ` - applies to ${scope}` : ''}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="overflow-y-auto p-4">
          {error && <p className="text-sm text-amber-600">{error}</p>}
          {!ranked && !error && <Spinner label="Fetching printings" />}
          {ranked && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {ranked.map((entry) => {
                const image = entry.card.image_uris?.normal ?? entry.card.card_faces?.[0]?.image_uris?.normal;
                const current = entry.card.id === card.id;
                return (
                  <button
                    key={entry.card.id}
                    type="button"
                    onClick={() => onPick(entry.card)}
                    className={`group rounded-lg border p-2 text-left transition ${
                      current ? 'border-accent' : 'border-edge hover:border-accent'
                    }`}
                  >
                    {image ? (
                      <img
                        src={image}
                        alt=""
                        loading="lazy"
                        className="mb-2 aspect-[63/88] w-full rounded object-cover"
                      />
                    ) : (
                      <div className="mb-2 aspect-[63/88] w-full rounded bg-edge" />
                    )}
                    <div className="truncate text-xs font-medium">{entry.card.set_name}</div>
                    <div className="flex items-center gap-1 text-[11px] text-muted">
                      <span>
                        {entry.card.set.toUpperCase()} {entry.card.collector_number}
                      </span>
                      {current && <Badge tone="good">current</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={entry.disqualified ? 'warn' : 'neutral'}>{entry.score}</Badge>
                      {entry.card.image_status !== 'highres_scan' && (
                        <Badge tone="warn">{entry.card.image_status}</Badge>
                      )}
                    </div>
                    {entry.disqualified && (
                      <p className="mt-1 text-[11px] text-amber-600">{entry.disqualified}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
