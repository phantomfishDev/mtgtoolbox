import { useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  PAPER_SIZES,
  comparePrintings,
  computeLayout,
  diffDeck,
  frontImageUrl,
  isBasicLand,
  missingOnly,
  parseDecklist,
  scorePrinting,
  totalCards,
  type PaperName,
  type ResolveResult,
  type ScryfallCard,
} from '@mtgproxy/core';
import { getClient } from '../platform/client.js';
import { useApp } from '../state.js';
import {
  activeProfile,
  distinctArtworks,
  expand,
  ownedKeysOf,
  resolveText,
  slotsToCards,
  type DeckSlot,
} from '../resolve.js';
import type { PrintSession } from '../session.js';
import { PrintingPicker } from '../components/PrintingPicker.js';
import { Badge, Button, Field, Panel, Select, Spinner, Toggle } from '../components/ui.js';

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
  const { collection, config } = useApp();
  const { text, result, overrides, options } = session;
  // Transient only: these should not survive a tab switch.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Informational, unlike `error`: the action worked but not perfectly. */
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState<DeckSlot | null>(null);

  const setText = (value: string) => onChange({ text: value });
  const setOptions = (value: typeof options) => onChange({ options: value });

  const profile = useMemo(() => activeProfile(config, DEFAULT_PROFILE), [config]);
  const ownedKeys = useMemo(() => ownedKeysOf(collection), [collection]);

  /** One tile per entry, or one per copy where a card has been split. */
  const slots = useMemo(
    () => (result ? expand(result.resolved, overrides) : []),
    [result, overrides],
  );
  /** Slots as resolved cards: 1:1 and in order, so diff rows line up by index. */
  const effective = useMemo(() => slotsToCards(slots), [slots]);

  const diff = useMemo(
    () => diffDeck(effective, collection, { assumeBasics: options.assumeBasics }),
    [effective, collection, options.assumeBasics],
  );

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
        .map((card) => scorePrinting(card, profile, { ownedKeys, isBasic: basic }))
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

  async function resolve() {
    setError(null);
    setBusy('Parsing decklist');
    try {
      const resolved = await resolveText(text, {
        profile,
        collection,
        config,
        ownedKeys,
        onProgress: setBusy,
      });
      onChange({ result: resolved, overrides: {} });
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
      const toPrint = options.missingOnly ? missingOnly(effective, diff) : effective;
      if (toPrint.length === 0) {
        setError('Nothing to print: you already own every card in this list.');
        return;
      }

      // One download per distinct printing, however many copies the deck runs.
      const unique = new Map<string, { card: ScryfallCard; quantity: number }>();
      for (const item of toPrint) {
        const existing = unique.get(item.card.id);
        if (existing) existing.quantity += item.entry.quantity;
        else unique.set(item.card.id, { card: item.card, quantity: item.entry.quantity });
      }

      const client = getClient();
      const items = [];
      let done = 0;
      for (const { card, quantity } of unique.values()) {
        setBusy(`Downloading images ${done + 1}/${unique.size}`);
        const url = frontImageUrl(card, options.quality);
        if (!url) continue;
        items.push({
          key: card.id,
          bytes: await client.image(url, `${card.id}:${options.quality}`),
          quantity,
          name: card.name,
        });
        done += 1;
      }

      setBusy('Building PDF');
      // pdf-lib is a large dependency and is only needed once someone actually
      // asks for a file, so it is fetched on demand rather than at page load.
      const { renderPdf } = await import('@mtgproxy/core/pdf');
      const rendered = await renderPdf(items, {
        layout: computeLayout({ paper: options.paper, gapMm: options.gap }),
        guides: options.guides,
        title: 'mtgproxy print sheet',
      });

      const blob = new Blob([rendered.bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'proxies.pdf';
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
    const cards = (options.missingOnly ? missingOnly(effective, diff) : effective).reduce(
      (sum, item) => sum + item.entry.quantity,
      0,
    );
    return { pages: Math.ceil(cards / layout.perPage), cards, perPage: layout.perPage };
  }, [effective, diff, options]);

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
              <Button variant="primary" onClick={resolve} disabled={busy !== null || !text.trim()}>
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
          </Panel>
        )}

        {error && (
          <Panel className="border-amber-500/50">
            <p className="text-sm text-amber-600">{error}</p>
          </Panel>
        )}

        {notice && (
          <Panel className="border-edge">
            <p className="text-sm text-muted">{notice}</p>
          </Panel>
        )}

        {result && <Warnings result={result} />}

        {result && slots.length > 0 && (
          <CardGrid
            slots={slots}
            diff={diff}
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
            <Toggle
              checked={options.missingOnly}
              onChange={(missingOnly) => setOptions({ ...options, missingOnly })}
              label="Only print what I don't own"
              hint={`${diff.totalMissing} of ${diff.totalNeeded} missing`}
            />
            <Toggle
              checked={options.assumeBasics}
              onChange={(assumeBasics) => setOptions({ ...options, assumeBasics })}
              label="Assume I have basic lands"
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
          ownedKeys={ownedKeys}
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

function Warnings({ result }: { result: ResolveResult }) {
  if (result.warnings.length === 0 && result.unresolved.length === 0) return null;
  return (
    <Panel className="border-amber-500/40">
      {result.unresolved.map((item) => (
        <p key={`${item.entry.line}-${item.entry.name}`} className="text-sm text-amber-600">
          Line {item.entry.line}: {item.reason}
        </p>
      ))}
      {result.warnings.map((warning, index) => (
        <p key={index} className="text-sm text-muted">
          {warning.message}
        </p>
      ))}
    </Panel>
  );
}

function CardGrid({
  slots,
  diff,
  onPick,
  onSplit,
  onCombine,
  onDistinctArt,
  busy,
}: {
  slots: DeckSlot[];
  diff: ReturnType<typeof diffDeck>;
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
        {slots.map((slot, index) => {
          const image = slot.card.image_uris?.normal ?? slot.card.card_faces?.[0]?.image_uris?.normal;
          // Diff rows are built from these slots in order, so index pairs exactly.
          const row = diff.rows[index];
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
                {row && row.missing === 0 && <Badge tone="good">owned</Badge>}
                {row && row.missing > 0 && row.owned > 0 && (
                  <Badge tone="warn">
                    {row.owned}/{row.needed}
                  </Badge>
                )}
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
