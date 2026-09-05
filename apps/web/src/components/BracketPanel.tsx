import { useState } from 'react';
import type { BracketAssessment } from '@mtgproxy/core';

/**
 * The deck's Commander bracket, with the cards that decided it.
 *
 * A single number, so it is a stat tile rather than a chart. The reasons are
 * the point: a bracket is something you say out loud to a table, so it has to
 * be checkable, and what the tool *cannot* determine is shown rather than
 * quietly folded into the number.
 */
export function BracketPanel({ assessment }: { assessment: BracketAssessment }) {
  const [showLimits, setShowLimits] = useState(false);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="shrink-0">
        <div className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-edge">
          <span className="text-3xl font-semibold leading-none tabular-nums">
            {assessment.bracket}
          </span>
          <span className="mt-1 text-[11px] text-muted">{assessment.name}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">{assessment.summary}</p>

        {assessment.signals.length > 0 && (
          <ul className="mt-3 space-y-2">
            {assessment.signals.map((signal) => (
              <li key={signal.code} className="text-sm">
                <p>{signal.explanation}</p>
                <p className="text-xs text-muted">{signal.cards.join(', ')}</p>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => setShowLimits((open) => !open)}
          className="mt-3 text-xs text-muted underline hover:text-accent"
        >
          {showLimits ? 'Hide what this cannot check' : 'What this cannot check'}
        </button>

        {showLimits && (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {assessment.unchecked.map((note) => (
              <li key={note}>&bull; {note}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
