import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  applyPins,
  assessBracket,
  diffDeck,
  manaCurve,
  normalizeName,
  readPins,
  type ResolveResult,
  type ResolvedCard,
  type ScryfallCard,
} from '@mtgproxy/core';
import type { BundledDeck } from '../decks.js';
import { useApp } from '../state.js';
import {
  activeProfile,
  categorise,
  resolveText,
  CATEGORY_ORDER,
  type CardCategory,
} from '../resolve.js';
import { BracketPanel } from '../components/BracketPanel.js';
import { PrintingPicker } from '../components/PrintingPicker.js';
import { ManaCurveChart } from '../components/ManaCurveChart.js';
import { useRetryNotice } from '../useRetryNotice.js';
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
  const { printed, config, deckPins, saveDeckPin, store } = useApp();
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [busy, setBusy] = useState<string | null>('Loading');
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<ScryfallCard | null>(null);
  /** The card whose printing is being chosen; null when the picker is shut. */
  const [picking, setPicking] = useState<ScryfallCard | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  /** Bumped to force a fresh resolution, bypassing the cache. */
  const [reloadToken, setReloadToken] = useState(0);
  const retryNotice = useRetryNotice();

  const profile = useMemo(() => activeProfile(config, DEFAULT_PROFILE), [config]);

  const overlay = useMemo(() => deckPins[deck.id] ?? {}, [deckPins, deck.id]);

  /**
   * The decklist with this deck's pins applied.
   *
   * Pins are expressed as `(SET) NUM` in the list itself, so applying them is a
   * text rewrite and everything downstream — resolution, the cache key, the
   * PDF — follows without knowing pins exist. Under `mtgproxy serve` the file
   * on disk already says this; re-applying it is a no-op, which is what keeps
   * the two modes identical.
   */
  const text = useMemo(() => applyPins(deck.text, overlay), [deck.text, overlay]);

  /**
   * What is pinned, read back off the list rather than off the overlay.
   *
   * The list is the source of truth, and it arrives already carrying pins that
   * were set in a previous session or typed by hand. Counting only this
   * session's overlay would report a fully pinned deck as having none.
   */
  const pins = useMemo(() => readPins(text), [text]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    setBusy('Loading');

    resolveText(text, {
      profile,
      config,
      force: reloadToken > 0,
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
  }, [text, profile, config, reloadToken]);

  const diff = useMemo(
    () => (result ? diffDeck(result.resolved, printed) : null),
    [result, printed],
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

  /**
   * Save a pin, or clear it.
   *
   * The write is awaited before the picker closes so that a failure — a server
   * that stopped, a read-only file — is reported rather than leaving the UI
   * showing a choice that never landed.
   */
  const pin = async (cardName: string, choice: ScryfallCard | null): Promise<void> => {
    setPinError(null);
    try {
      await saveDeckPin(
        deck.id,
        cardName,
        choice ? { set: choice.set.toLowerCase(), collectorNumber: choice.collector_number } : null,
      );
      setPicking(null);
      setZoomed(null);
    } catch (cause: unknown) {
      setPinError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const total = result?.resolved.reduce((sum, item) => sum + item.entry.quantity, 0) ?? 0;
  const curve = useMemo(() => (result ? manaCurve(result.resolved) : null), [result]);
  const pinCount = Object.keys(pins).length;
  const bracket = useMemo(() => (result ? assessBracket(result.resolved) : null), [result]);

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
                  {diff.totalPrinted} printed, {diff.totalToPrint} to print
                </span>
              </>
            )}
            {pinCount > 0 && (
              <>
                <span>&middot;</span>
                <span>
                  {pinCount} pinned printing{pinCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-muted">
            Click a card to change its printing. Pins are saved to {store.pinTarget}.
          </p>
        </div>
        <Button variant="primary" onClick={() => onPrint(deck)}>
          Print this deck
        </Button>
      </div>

      {busy && (
        <Panel>
          <Spinner label={busy} />
          {retryNotice && <p className="mt-2 text-xs text-amber-600">{retryNotice}</p>}
        </Panel>
      )}

      {error && (
        <Panel className="border-amber-500/50">
          <p className="text-sm text-amber-600">{error}</p>
          <div className="mt-3">
            <Button onClick={() => setReloadToken((n) => n + 1)}>Try again</Button>
          </div>
        </Panel>
      )}

      {pinError && (
        <Panel className="border-amber-500/40">
          <p className="text-sm text-amber-600">Could not save that pin: {pinError}</p>
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

      {bracket && (
        <Panel>
          <h3 className="mb-3 text-sm font-semibold">Commander bracket</h3>
          <BracketPanel assessment={bracket} />
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
                toPrint={diff?.rows.find((row) => row.card.id === item.card.id)?.toPrint ?? 0}
                pinned={pins[normalizeName(item.card.name)] !== undefined}
                onZoom={() => setZoomed(item.card)}
                onChangePrinting={() => setPicking(item.card)}
              />
            ))}
          </div>
        </section>
      ))}

      {zoomed && (
        <Lightbox
          card={zoomed}
          pinned={pins[normalizeName(zoomed.name)] !== undefined}
          onChangePrinting={() => {
            setPicking(zoomed);
            setZoomed(null);
          }}
          onUnpin={() => void pin(zoomed.name, null)}
          onClose={() => setZoomed(null)}
        />
      )}

      {picking && (
        <PrintingPicker
          card={picking}
          profile={profile}
          scope={`every copy in ${deck.name}`}
          onPick={(chosen) => void pin(picking.name, chosen)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function CardTile({
  item,
  toPrint,
  pinned,
  onZoom,
  onChangePrinting,
}: {
  item: ResolvedCard;
  toPrint: number;
  pinned: boolean;
  onZoom: () => void;
  onChangePrinting: () => void;
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
        {toPrint === 0 && (
          <span className="absolute right-1 top-1 rounded bg-emerald-500/90 px-1 py-0.5 text-[10px] font-semibold text-white">
            printed
          </span>
        )}
        {pinned && (
          <span
            title={`Pinned to ${item.card.set.toUpperCase()} ${item.card.collector_number}`}
            className="absolute bottom-1 left-1 rounded bg-accent/90 px-1 py-0.5 text-[10px] font-semibold text-surface"
          >
            pinned
          </span>
        )}
      </button>
      <div className="flex items-baseline justify-between gap-1">
        <p className="truncate text-[11px] text-muted" title={item.card.name}>
          {item.card.name}
        </p>
        <button
          type="button"
          onClick={onChangePrinting}
          title={`Change the printing of ${item.card.name}`}
          className="shrink-0 text-[11px] text-muted underline hover:text-accent"
        >
          art
        </button>
      </div>
    </div>
  );
}

/** Full-size look at one card, since the grid tiles are small by design. */
function Lightbox({
  card,
  pinned,
  onChangePrinting,
  onUnpin,
  onClose,
}: {
  card: ScryfallCard;
  pinned: boolean;
  onChangePrinting: () => void;
  onUnpin: () => void;
  onClose: () => void;
}) {
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
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {card.image_status !== 'highres_scan' && <Badge tone="warn">{card.image_status}</Badge>}
          {pinned && <Badge tone="good">pinned</Badge>}
          <Button onClick={onChangePrinting}>Change printing</Button>
          {pinned && (
            <Button variant="ghost" onClick={onUnpin}>
              Remove pin
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
