import { useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  PAPER_SIZES,
  comparePrintings,
  computeLayout,
  isBasicLand,
  isDoubleFaced,
  parseDecklist,
  placementCount,
  printPlacements,
  scorePrinting,
  totalCards,
  type PaperName,
  type ResolveResult,
  type ScryfallCard,
} from '@mtgtoolbox/core';
import { getClient } from '../platform/client.js';
import { useApp } from '../state.js';
import {
  activeProfile,
  distinctArtworks,
  expand,
  resolveText,
  slotsToCards,
  type DeckSlot,
} from '../resolve.js';
import type { PrintSession } from '../session.js';
import type { TokenMode } from '@mtgtoolbox/core';
import { useRetryNotice } from '../useRetryNotice.js';
import { PrintingPicker } from '../components/PrintingPicker.js';
import { Button, Field, Panel, Select, Spinner, Toggle } from '../components/ui.js';
import { APP_TITLE } from '../showcase.js';

const SAMPLE = `1 Arcane Signet
1 Command Tower
1 Cultivate
1 Sol Ring
4 Swamp`;

export function PrintView({
  session,
  onChange,
}: {
  session: PrintSession;
  onChange: (patch: Partial<PrintSession>) => void;
}) {
  const { config } = useApp();
  const { text, deckId, result, overrides, options } = session;
  // Transient only: these should not survive a tab switch.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Informational, unlike `error`: the action worked but not perfectly. */
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<DeckSlot | null>(null);
  const retryNotice = useRetryNotice();

  // Editing the list detaches it from the deck it came from: the stored card
  // data beside that deck no longer describes what is in the box.
  const setText = (value: string) => onChange({ text: value, deckId: null });
  const setOptions = (value: typeof options) => onChange({ options: value });

  const profile = useMemo(() => activeProfile(config, DEFAULT_PROFILE), [config]);

  /** One tile per entry, or one per copy where a card has been split. */
  const slots = useMemo(
    () => (result ? expand(result.resolved, overrides) : []),
    [result, overrides],
  );
  /** Slots as resolved cards: 1:1 and in order. */
  const effective = useMemo(() => slotsToCards(slots), [slots]);

  /** Write a printing to one slot: either to every copy, or to just this one. */
  function choosePrinting(slot: DeckSlot, card: ScryfallCard): void {
    const choice = overrides[slot.key] ?? {};
    if (slot.copyIndex === null) {
      onChange({ overrides: { ...overrides, [slot.key]: { ...choice, all: card } } });
      return;
    }
    const copies = [...(choice.copies ?? Array.from({ length: slot.totalCopies }, () => null))];
    copies[slot.copyIndex] = card;
    onChange({ overrides: { ...overrides, [slot.key]: { ...choice, copies } } });
  }

  /** Give each copy its own printing, starting from the one in use. */
  function splitCopies(slot: DeckSlot): void {
    const choice = overrides[slot.key] ?? {};
    const copies = Array.from({ length: slot.totalCopies }, () => choice.all ?? slot.card);
    onChange({ overrides: { ...overrides, [slot.key]: { ...choice, copies } } });
  }

  /** Back to one shared printing for every copy. */
  function combineCopies(slot: DeckSlot): void {
    const { copies: _dropped, ...rest } = overrides[slot.key] ?? {};
    onChange({ overrides: { ...overrides, [slot.key]: rest } });
  }

  /**
   * Assign a visibly different artwork to each copy.
   *
   * This is the point of splitting for a card printed in many arts, and doing
   * it by hand nine times is tedious enough that nobody would.
   */
  async function assignDistinctArt(slot: DeckSlot): Promise<void> {
    setError(null);
    setNotice(null);
    setBusy(`Finding artworks for ${slot.entry.name}`);
    try {
      const candidates = await getClient().prints(slot.entry.name);
      if (candidates.length === 0) throw new Error(`No printings found for ${slot.entry.name}.`);
      const basic = isBasicLand(candidates[0]!);
      const eligible = candidates
        .map((card) => scorePrinting(card, profile, { isBasic: basic }))
        .filter((entry) => !entry.disqualified)
        .sort(comparePrintings)
        .map((entry) => entry.card);
      // Nothing survives the profile's hard rules: fall back rather than give up.
      const relaxed = eligible.length === 0;
      const { chosen, distinct } = distinctArtworks(relaxed ? candidates : eligible, slot.totalCopies);

      const choice = overrides[slot.key] ?? {};
      onChange({ overrides: { ...overrides, [slot.key]: { ...choice, copies: chosen } } });

      // Repeating a copy silently would look like a bug, so say what happened
      // and which preference is responsible for it.
      if (distinct < slot.totalCopies) {
        const all = distinctArtworks(candidates, slot.totalCopies).distinct;
        setNotice(
          `${slot.entry.name}: ${distinct} distinct artwork${distinct === 1 ? '' : 's'} available ` +
            `for ${slot.totalCopies} copies, so some repeat.` +
            (all > distinct
              ? ` ${all} exist in total — the rest are excluded by your printing preferences` +
                (profile.requireHighres ? `, mainly "only use high-resolution scans".` : '.')
              : ''),
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Resolve the list. A changed token mode passes `tokens` and keeps the art
   * already chosen: it adds or drops the token rows, and the deck's own cards
   * are the same cards as before.
   */
  async function resolve(force = false, tokens?: TokenMode) {
    setError(null);
    setNotice(null);
    setBusy('Parsing decklist');
    try {
      const resolved = await resolveText(text, {
        profile,
        config,
        tokenMode: tokens ?? options.tokens,
        ...(deckId ? { deckId } : {}),
        force,
        onProgress: setBusy,
      });
      onChange({ result: resolved, overrides: tokens ? overrides : {} });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!result) return;
    setError(null);
    try {
      // One download per distinct printing and face, however many copies the
      // deck runs. The CLI builds its sheets from the same helper.
      const { placements, skipped } = printPlacements(effective, {
        quality: options.quality,
        bothFaces: options.bothFaces,
      });

      const client = getClient();
      const items = [];
      let done = 0;
      for (const placement of placements) {
        setBusy(`Downloading images ${done + 1}/${placements.length}`);
        items.push({
          key: placement.key,
          bytes: await client.image(placement.url, `${placement.key}:${options.quality}`),
          quantity: placement.quantity,
          name: placement.name,
        });
        done += 1;
      }
      if (skipped.length > 0) setNotice(skipped.join('; '));

      setBusy('Building PDF');
      // pdf-lib is a large dependency and is only needed once someone actually
      // asks for a file, so it is fetched on demand rather than at page load.
      const { renderPdf } = await import('@mtgtoolbox/core/pdf');
      const rendered = await renderPdf(items, {
        layout: computeLayout({ paper: options.paper, gapMm: options.gap }),
        guides: options.guides,
        title: `${APP_TITLE} print sheet`,
      });

      const blob = new Blob([rendered.bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'print-sheet.pdf';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const pageCount = useMemo(() => {
    const layout = computeLayout({ paper: options.paper, gapMm: options.gap });
    const { placements } = printPlacements(effective, {
      quality: options.quality,
      bothFaces: options.bothFaces,
    });
    const cards = placementCount(placements);
    return { pages: Math.ceil(cards / layout.perPage), cards, perPage: layout.perPage };
  }, [effective, options]);

  /** Backs available to print, so the toggle can say what it would add. */
  const backCount = useMemo(
    () =>
      effective.reduce(
        (sum, item) => (isDoubleFaced(item.card) ? sum + item.entry.quantity : sum),
        0,
      ),
    [effective],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Decklist</h2>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setText(SAMPLE)}>
                Use sample
              </Button>
              <Button
                variant="primary"
                onClick={() => void resolve()}
                disabled={busy !== null || !text.trim()}
              >
                Resolve
              </Button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            placeholder={'1 Sol Ring\n7 Swamp\n1 Cultivate (MSC) 172\n\nPaste a decklist, or a whole markdown deck guide.'}
            className="deck-input h-56 w-full resize-y rounded-md border border-edge bg-surface p-3 font-mono text-sm"
          />
          {text.trim() && (
            <p className="mt-2 text-xs text-muted">
              {totalCards(parseDecklist(text).entries)} cards
            </p>
          )}
        </Panel>

        {busy && (
          <Panel>
            <Spinner label={busy} />
            {retryNotice && <p className="mt-2 text-xs text-amber-600">{retryNotice}</p>}
          </Panel>
        )}

        {error && (
          <Panel className="border-amber-500/50">
            <p className="text-sm text-amber-600">{error}</p>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void resolve(true)} disabled={busy !== null || !text.trim()}>
                Try again
              </Button>
            </div>
          </Panel>
        )}

        {notice && (
          <Panel className="border-edge">
            <p className="text-sm text-muted">{notice}</p>
          </Panel>
        )}

        {result && <Warnings result={result} bothFaces={options.bothFaces} />}

        {result && slots.length > 0 && (
          <CardGrid
            slots={slots}
            onPick={setPicking}
            onSplit={splitCopies}
            onCombine={combineCopies}
            onDistinctArt={(slot) => void assignDistinctArt(slot)}
            busy={busy !== null}
          />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Panel>
          <h2 className="mb-3 font-semibold">Sheet</h2>
          <div className="flex flex-col gap-3">
            <Field label="Paper">
              <Select
                value={options.paper}
                onChange={(paper) => setOptions({ ...options, paper })}
                options={Object.keys(PAPER_SIZES).map((value) => ({
                  value: value as PaperName,
                  label: value.toUpperCase(),
                }))}
              />
            </Field>
            <Field label="Cut guides">
              <Select
                value={options.guides}
                onChange={(guides) => setOptions({ ...options, guides })}
                options={[
                  { value: 'crop', label: 'Crop marks in margins' },
                  { value: 'lines', label: 'Lines across the sheet' },
                  { value: 'none', label: 'None' },
                ]}
              />
            </Field>
            <Field label="Image quality">
              <Select
                value={options.quality}
                onChange={(quality) => setOptions({ ...options, quality })}
                options={[
                  { value: 'png', label: 'PNG - 298 DPI, large files' },
                  { value: 'large', label: 'Large - 269 DPI, ~10x smaller' },
                  { value: 'normal', label: 'Normal - 195 DPI' },
                ]}
              />
            </Field>
            <Field label="Tokens">
              <Select
                value={options.tokens}
                onChange={(value) => {
                  const tokens = value as TokenMode;
                  setOptions({ ...options, tokens });
                  // A list already resolved under the old mode would print
                  // the wrong cards, so resolve again under the new one.
                  if (result) void resolve(false, tokens);
                }}
                options={[
                  { value: 'exclude', label: 'Exclude - deck only' },
                  { value: 'include', label: 'Include - deck and tokens' },
                  { value: 'only', label: 'Only - tokens on their own sheet' },
                ]}
              />
            </Field>
            <Toggle
              checked={options.bothFaces}
              onChange={(bothFaces) => setOptions({ ...options, bothFaces })}
              label="Print both sides of double-faced cards"
              hint={
                backCount === 0
                  ? 'No double-faced cards in this list'
                  : `${backCount} back face${backCount === 1 ? '' : 's'} to print`
              }
            />
          </div>

          <div className="mt-4 border-t border-edge pt-3 text-sm text-muted">
            {pageCount.cards} cards, {pageCount.pages} page{pageCount.pages === 1 ? '' : 's'},{' '}
            {pageCount.perPage} per sheet
          </div>

          <div className="mt-3">
            <Button
              variant="primary"
              onClick={generate}
              disabled={busy !== null || !result || pageCount.cards === 0}
            >
              Download PDF
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Print at 100% scale with &ldquo;fit to page&rdquo; turned off, or the cards come out the
            wrong size.
          </p>
        </Panel>
      </div>

      {picking && (
        <PrintingPicker
          card={picking.card}
          scope={
            picking.copyIndex === null
              ? picking.totalCopies > 1
                ? `all ${picking.totalCopies} copies`
                : null
              : `copy ${picking.copyIndex + 1} of ${picking.totalCopies}`
          }
          profile={profile}
          onPick={(card) => {
            choosePrinting(picking, card);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function Warnings({ result, bothFaces }: { result: ResolveResult; bothFaces: boolean }) {
  // The front-face-only warning is exactly what the both-sides toggle answers,
  // so leave it off once that is on rather than contradicting the sheet.
  const warnings = bothFaces
    ? result.warnings.filter((warning) => warning.code !== 'double-faced')
    : result.warnings;
  if (warnings.length === 0 && result.unresolved.length === 0) return null;
  return (
    <Panel className="border-amber-500/40">
      {result.unresolved.map((item) => (
        <p key={`${item.entry.line}-${item.entry.name}`} className="text-sm text-amber-600">
          Line {item.entry.line}: {item.reason}
        </p>
      ))}
      {warnings.map((warning, index) => (
        <p key={index} className="text-sm text-muted">
          {warning.message}
        </p>
      ))}
    </Panel>
  );
}

function CardGrid({
  slots,
  onPick,
  onSplit,
  onCombine,
  onDistinctArt,
  busy,
}: {
  slots: DeckSlot[];
  onPick: (slot: DeckSlot) => void;
  onSplit: (slot: DeckSlot) => void;
  onCombine: (slot: DeckSlot) => void;
  onDistinctArt: (slot: DeckSlot) => void;
  busy: boolean;
}) {
  const total = slots.reduce((sum, slot) => sum + slot.quantity, 0);

  return (
    <Panel>
      <h2 className="mb-3 font-semibold">
        {total} cards{' '}
        <span className="text-sm font-normal text-muted">
          &mdash; click any card to choose a different printing
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {slots.map((slot) => {
          const image = slot.card.image_uris?.normal ?? slot.card.card_faces?.[0]?.image_uris?.normal;
          const split = slot.copyIndex !== null;
          return (
            <div key={`${slot.key}-${slot.copyIndex ?? 'all'}-${slot.entry.line}`} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onPick(slot)}
                className="relative overflow-hidden rounded-lg border border-edge transition hover:border-accent"
              >
                {image ? (
                  <img
                    src={image}
                    alt={slot.card.name}
                    loading="lazy"
                    className="aspect-[63/88] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[63/88] w-full items-center justify-center bg-edge p-2 text-center text-xs">
                    {slot.card.name}
                  </div>
                )}
                {slot.quantity > 1 && (
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {slot.quantity}x
                  </span>
                )}
                {split && (
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {slot.copyIndex! + 1} of {slot.totalCopies}
                  </span>
                )}
              </button>

              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                <span>
                  {slot.card.set.toUpperCase()} {slot.card.collector_number}
                </span>
              </div>

              {/* Copy controls sit on the first tile of a multi-copy card only,
                  so a nine-copy card does not repeat them nine times. */}
              {slot.totalCopies > 1 && (slot.copyIndex === null || slot.copyIndex === 0) && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {split ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onCombine(slot)}
                      className="underline hover:text-accent disabled:opacity-40"
                    >
                      same printing for all {slot.totalCopies}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDistinctArt(slot)}
                        className="underline hover:text-accent disabled:opacity-40"
                      >
                        different art each
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onSplit(slot)}
                        className="underline hover:text-accent disabled:opacity-40"
                      >
                        choose per copy
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
