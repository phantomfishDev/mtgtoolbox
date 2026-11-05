import { useState } from 'react';
import type { ManaCurve } from '@mtgtoolbox/core';

/**
 * Mana curve as a column chart.
 *
 * One series, so one hue and no legend — the heading says what is plotted, and
 * colouring the bars by mana value would only restate the x-axis. Counts ride
 * the caps, so the chart needs no gridlines.
 */

/** Plot height in pixels; bars scale against the tallest bucket. */
const PLOT_HEIGHT = 150;

export function ManaCurveChart({ curve }: { curve: ManaCurve }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  if (curve.spells === 0) {
    return <p className="text-sm text-muted">No nonland cards to chart.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          {curve.spells} spells, {curve.lands} lands &middot; average mana value{' '}
          <span className="font-medium text-ink">{curve.averageManaValue.toFixed(2)}</span>
        </p>
        <button
          type="button"
          onClick={() => setShowTable((open) => !open)}
          className="text-xs text-muted underline hover:text-accent"
        >
          {showTable ? 'Hide table' : 'Show as table'}
        </button>
      </div>

      {/* Bars cap at 24px, so a full-width plot leaves each column mostly air and
          the chart reads as scattered lollipops. Constrain it to a width where
          the bars and their gaps stay in proportion. */}
      <div className="relative max-w-lg">
        {/* gap-0.5 is the 2px surface gap that separates neighbouring columns. */}
        <div className="flex items-end gap-0.5" style={{ height: PLOT_HEIGHT }}>
          {curve.buckets.map((bucket) => {
            const height = curve.peak === 0 ? 0 : (bucket.count / curve.peak) * (PLOT_HEIGHT - 18);
            return (
              <div
                key={bucket.manaValue}
                className="flex h-full flex-1 flex-col justify-end items-center"
                onMouseEnter={() => setHovered(bucket.manaValue)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(bucket.manaValue)}
                onBlur={() => setHovered(null)}
                tabIndex={bucket.count > 0 ? 0 : -1}
                aria-label={`Mana value ${bucket.label}: ${bucket.count} cards`}
              >
                <span className="mb-1 text-[11px] tabular-nums text-muted">
                  {bucket.count > 0 ? bucket.count : ''}
                </span>
                <div
                  className="w-full max-w-6 rounded-t transition-opacity"
                  style={{
                    height: Math.max(bucket.count > 0 ? 2 : 0, height),
                    background: 'var(--color-chart-1)',
                    opacity: hovered === null || hovered === bucket.manaValue ? 1 : 0.45,
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Hairline baseline; no gridlines, since every column is labelled. */}
        <div className="h-px w-full" style={{ background: 'var(--color-grid)' }} />

        <div className="flex gap-0.5">
          {curve.buckets.map((bucket) => (
            <div key={bucket.manaValue} className="flex-1 pt-1 text-center text-[11px] text-muted">
              {bucket.label}
            </div>
          ))}
        </div>

        {hovered !== null && (curve.buckets[hovered]?.count ?? 0) > 0 && (
          <div className="pointer-events-none absolute left-0 top-0 z-10 max-w-xs rounded-md border border-edge bg-surface p-2 text-xs shadow-lg">
            <p className="mb-1 font-medium">
              Mana value {curve.buckets[hovered]!.label} &middot; {curve.buckets[hovered]!.count}{' '}
              cards
            </p>
            <p className="text-muted">
              {curve.buckets[hovered]!.cards
                .map((c) => (c.quantity > 1 ? `${c.quantity}x ${c.name}` : c.name))
                .join(', ')}
            </p>
          </div>
        )}
      </div>

      {showTable && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-edge">
              <th className="pb-1 font-medium">MV</th>
              <th className="pb-1 font-medium">Cards</th>
              <th className="pb-1 text-right font-medium">Count</th>
            </tr>
          </thead>
          <tbody>
            {curve.buckets
              .filter((bucket) => bucket.count > 0)
              .map((bucket) => (
                <tr key={bucket.manaValue} className="border-b border-edge/50 align-top">
                  <td className="py-1 tabular-nums">{bucket.label}</td>
                  <td className="py-1 text-muted">
                    {bucket.cards
                      .map((c) => (c.quantity > 1 ? `${c.quantity}x ${c.name}` : c.name))
                      .join(', ')}
                  </td>
                  <td className="py-1 text-right tabular-nums">{bucket.count}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {curve.caveats.length > 0 && (
        <div className="rounded-md border border-edge p-3">
          <p className="mb-1 text-xs font-semibold">Where the printed curve misleads</p>
          <ul className="space-y-1 text-xs text-muted">
            {curve.caveats.map((caveat) => (
              <li key={caveat.code}>
                {caveat.message}{' '}
                <span className="opacity-70">{caveat.cards.join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
