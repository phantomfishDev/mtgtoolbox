import { useMemo, useState } from 'react';
import {
  DEFAULT_PROFILE,
  PAPER_SIZES,
  computeLayout,
  diffDeck,
  frontImageUrl,
  hasActivePreferences,
  mergeProfiles,
  mergeEntries,
  missingOnly,
  normalizeName,
  parseDecklist,
  resolveDeck,
  resolveDeckWithPreferences,
  totalCards,
  type PaperName,
  type ResolveResult,
  type ResolvedCard,
  type ScryfallCard,
} from '@mtgproxy/core';
import { getClient } from '../platform/client.js';
import { useApp } from '../state.js';
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
  const [picking, setPicking] = useState<ScryfallCard | null>(null);

  const setText = (value: string) => onChange({ text: value });
  const setOptions = (value: typeof options) => onChange({ options: value });

  const profile = useMemo(() => {
    const named = config.defaultProfile ? config.profiles?.[config.defaultProfile] : undefined;
    return mergeProfiles(DEFAULT_PROFILE, named);
  }, [config]);

  const ownedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of collection.cards) {
      if (entry.scryfallId) keys.add(entry.scryfallId);
      keys.add(`${entry.set.toLowerCase()}|${entry.collectorNumber.toLowerCase()}`);
    }
    return keys;
  }, [collection]);

  /** Resolved cards with any manual printing overrides applied. */
  const effective = useMemo<ResolvedCard[]>(() => {
    if (!result) return [];
    return result.resolved.map((item) => {
      const override = overrides[normalizeName(item.entry.name)];
      return override ? { ...item, card: override } : item;
    });
  }, [result, overrides]);

  const diff = useMemo(
    () => diffDeck(effective, collection, { assumeBasics: options.assumeBasics }),
    [effective, collection, options.assumeBasics],
  );

  async function resolve() {
    setError(null);
    setBusy('Parsing decklist');
    try {
      const parsed = parseDecklist(text);
      if (parsed.entries.length === 0) throw new Error('No cards found in that list.');
      const entries = mergeEntries(parsed.entries);
      const client = getClient();

      const hasCollection = collection.cards.length > 0;
      const pins = config.pins ?? {};
      const wantsPreferences =
        hasActivePreferences(profile, { hasCollection }) || Object.keys(pins).length > 0;

      let resolved: ResolveResult;
      if (wantsPreferences) {
        const distinct = new Set(entries.map((entry) => normalizeName(entry.name))).size;
        setBusy(`Ranking printings for ${distinct} cards`);
        resolved = await resolveDeckWithPreferences(entries, client, {
          profile,
          ownedKeys,
          pins,
          onProgress: (done, total) => setBusy(`Ranking printings ${done}/${total}`),
        });
      } else {
        setBusy('Looking up cards');
        resolved = await resolveDeck(entries, client);
      }

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

        {result && <Warnings result={result} />}

        {result && effective.length > 0 && (
          <CardGrid
            cards={effective}
            diff={diff}
            onPick={setPicking}
            overrides={overrides}
            onReset={(name) => {
              const next = { ...overrides };
              delete next[name];
              onChange({ overrides: next });
            }}
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
          card={picking}
          profile={profile}
          ownedKeys={ownedKeys}
          onPick={(card) => {
            onChange({ overrides: { ...overrides, [normalizeName(card.name)]: card } });
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
  cards,
  diff,
  onPick,
  overrides,
  onReset,
}: {
  cards: ResolvedCard[];
  diff: ReturnType<typeof diffDeck>;
  onPick: (card: ScryfallCard) => void;
  overrides: Record<string, ScryfallCard>;
  onReset: (name: string) => void;
}) {
  const rowFor = (id: string) => diff.rows.find((row) => row.card.id === id);

  return (
    <Panel>
      <h2 className="mb-3 font-semibold">
        {cards.length} cards{' '}
        <span className="text-sm font-normal text-muted">
          &mdash; click any card to choose a different printing
        </span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {cards.map((item) => {
          const image =
            item.card.image_uris?.normal ?? item.card.card_faces?.[0]?.image_uris?.normal;
          const row = rowFor(item.card.id);
          const name = normalizeName(item.entry.name);
          const overridden = name in overrides;
          return (
            <div key={`${item.card.id}-${item.entry.line}`} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onPick(item.card)}
                className="group relative overflow-hidden rounded-lg border border-edge transition hover:border-accent"
              >
                {image ? (
                  <img src={image} alt={item.card.name} loading="lazy" className="aspect-[63/88] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[63/88] w-full items-center justify-center bg-edge p-2 text-center text-xs">
                    {item.card.name}
                  </div>
                )}
                {item.entry.quantity > 1 && (
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {item.entry.quantity}x
                  </span>
                )}
              </button>
              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                <span>
                  {item.card.set.toUpperCase()} {item.card.collector_number}
                </span>
                {row && row.missing === 0 && <Badge tone="good">owned</Badge>}
                {row && row.missing > 0 && row.owned > 0 && (
                  <Badge tone="warn">
                    {row.owned}/{row.needed}
                  </Badge>
                )}
                {overridden && (
                  <button
                    type="button"
                    onClick={() => onReset(name)}
                    className="underline hover:text-accent"
                  >
                    reset
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
