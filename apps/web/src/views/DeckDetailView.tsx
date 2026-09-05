import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  diffDeck,
  manaCurve,
  normalizeName,
  type ResolveResult,
  type ResolvedCard,
  type ScryfallCard,
} from '@mtgproxy/core';
import type { BundledDeck } from '../decks.js';
import { useApp } from '../state.js';
import {
  activeProfile,
  categorise,
  ownedKeysOf,
  resolveText,
  CATEGORY_ORDER,
  type CardCategory,
} from '../resolve.js';
import { ManaCurveChart } from '../components/ManaCurveChart.js';
import { Badge, Button, Panel, Spinner } from '../components/ui.js';

/**
 * Browse one deck card by card.
 *
 * Resolves through the same path the printer uses, so what is on screen here is
 * exactly what would come out of the PDF — including which printing of each
 * card was chosen.
 */
export function DeckDetailView({
  deck,
  onBack,
  onPrint,
}: {
  deck: BundledDeck;
  onBack: () => void;
  onPrint: (deck: BundledDeck) => void;
}) {
  const { collection, config } = useApp();
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [busy, setBusy] = useState<string | null>('Loading');
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<ScryfallCard | null>(null);

  const profile = useMemo(() => activeProfile(config, DEFAULT_PROFILE), [config]);
  const ownedKeys = useMemo(() => ownedKeysOf(collection), [collection]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setBusy('Loading');

    resolveText(deck.text, {
      profile,
      collection,
      config,
      ownedKeys,
      onProgress: (message) => {
        if (!cancelled) setBusy(message);
      },
    })
      .then((resolved) => {
        if (!cancelled) setResult(resolved);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });

    return () => {
      cancelled = true;
    };
  }, [deck.text, profile, collection, config, ownedKeys]);

  const diff = useMemo(
    () => (result ? diffDeck(result.resolved, collection, { assumeBasics: true }) : null),
    [result, collection],
  );

  const commanderNames = useMemo(
    () => new Set(deck.commanders.map(normalizeName)),
    [deck.commanders],
  );

  const groups = useMemo(() => {
    if (!result) return [];
    const buckets = new Map<CardCategory, ResolvedCard[]>();
    for (const item of result.resolved) {
      const typeLine = item.card.type_line ?? item.card.card_faces?.[0]?.type_line ?? '';
      const category = categorise(typeLine, commanderNames.has(normalizeName(item.card.name)));
      const bucket = buckets.get(category);
      if (bucket) bucket.push(item);
      else buckets.set(category, [item]);
    }
    return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
      category,
      cards: buckets.get(category)!,
      count: buckets.get(category)!.reduce((sum, item) => sum + item.entry.quantity, 0),
    }));
  }, [result, commanderNames]);

  const total = result?.resolved.reduce((sum, item) => sum + item.entry.quantity, 0) ?? 0;
  const curve = useMemo(() => (result ? manaCurve(result.resolved) : null), [result]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-1 text-sm text-muted underline hover:text-accent"
          >
            &larr; All decks
          </button>
          <h2 className="text-xl font-semibold">{deck.name}</h2>
          {deck.commanders.length > 0 && (
            <p className="text-sm text-muted">{deck.commanders.join(' / ')}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{deck.cardCount} cards</span>
            {diff && (
              <>
                <span>&middot;</span>
                <span>
                  {diff.totalOwned} owned, {diff.totalMissing} to proxy
                </span>
              </>
            )}
          </p>
        </div>
        <Button variant="primary" onClick={() => onPrint(deck)}>
          Print this deck
        </Button>
      </div>

      {busy && (
        <Panel>
          <Spinner label={busy} />
        </Panel>
      )}

      {error && (
        <Panel className="border-amber-500/50">
          <p className="text-sm text-amber-600">{error}</p>
        </Panel>
      )}

      {result && result.unresolved.length > 0 && (
        <Panel className="border-amber-500/40">
          {result.unresolved.map((item) => (
            <p key={item.entry.line} className="text-sm text-amber-600">
              Line {item.entry.line}: {item.reason}
            </p>
          ))}
        </Panel>
      )}

      {result && total !== 100 && (
        <Panel className="border-amber-500/40">
          <p className="text-sm text-amber-600">
            This deck has {total} cards. A Commander deck is 100.
          </p>
        </Panel>
      )}

      {curve && (
        <Panel>
          <h3 className="mb-3 text-sm font-semibold">Mana curve</h3>
          <ManaCurveChart curve={curve} />
        </Panel>
      )}

      {groups.map((group) => (
        <section key={group.category}>
          <h3 className="mb-2 text-sm font-semibold">
            {group.category}{' '}
            <span className="font-normal text-muted">({group.count})</span>
          </h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {group.cards.map((item) => (
              <CardTile
                key={`${item.card.id}-${item.entry.line}`}
                item={item}
                missing={diff?.rows.find((row) => row.card.id === item.card.id)?.missing ?? 0}
                onZoom={() => setZoomed(item.card)}
              />
            ))}
          </div>
        </section>
      ))}

      {zoomed && <Lightbox card={zoomed} onClose={() => setZoomed(null)} />}
    </div>
  );
}

function CardTile({
  item,
  missing,
  onZoom,
}: {
  item: ResolvedCard;
  missing: number;
  onZoom: () => void;
}) {
  const image = item.card.image_uris?.normal ?? item.card.card_faces?.[0]?.image_uris?.normal;
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onZoom}
        title={`${item.card.name} - ${item.card.set_name}`}
        className="relative overflow-hidden rounded-lg border border-edge transition hover:border-accent"
      >
        {image ? (
          <img
            src={image}
            alt={item.card.name}
            loading="lazy"
            className="aspect-[63/88] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[63/88] w-full items-center justify-center bg-edge p-1 text-center text-[10px]">
            {item.card.name}
          </div>
        )}
        {item.entry.quantity > 1 && (
          <span className="absolute left-1 top-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
            {item.entry.quantity}x
          </span>
        )}
        {missing === 0 && (
          <span className="absolute right-1 top-1 rounded bg-emerald-500/90 px-1 py-0.5 text-[10px] font-semibold text-white">
            owned
          </span>
        )}
      </button>
      <p className="truncate text-[11px] text-muted" title={item.card.name}>
        {item.card.name}
      </p>
    </div>
  );
}

/** Full-size look at one card, since the grid tiles are small by design. */
function Lightbox({ card, onClose }: { card: ScryfallCard; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const faces = card.card_faces?.length
    ? card.card_faces.filter((face) => face.image_uris?.large ?? face.image_uris?.normal)
    : [];
  const images = faces.length
    ? faces.map((face) => face.image_uris!.large ?? face.image_uris!.normal!)
    : [card.image_uris?.large ?? card.image_uris?.normal].filter(Boolean as unknown as (v: string | undefined) => v is string);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div className="flex flex-wrap justify-center gap-4" onClick={(e) => e.stopPropagation()}>
        {images.map((src) => (
          <img
            key={src}
            src={src}
            alt={card.name}
            className="max-h-[70vh] rounded-xl shadow-2xl"
          />
        ))}
      </div>
      <div className="text-center text-sm text-white" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium">{card.name}</p>
        <p className="text-white/70">
          {card.set_name} &middot; {card.set.toUpperCase()} {card.collector_number}
        </p>
        <div className="mt-2 flex items-center justify-center gap-2">
          {card.image_status !== 'highres_scan' && <Badge tone="warn">{card.image_status}</Badge>}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
