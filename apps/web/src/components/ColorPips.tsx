/**
 * A deck's colour identity as Magic's five mana symbols.
 *
 * The letter sits inside each pip, so identity never rests on colour alone —
 * which matters here because two of the five (white and black) are separated
 * mostly by luminance.
 */
const COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  W: { bg: '#f8f6d8', fg: '#3a3520', label: 'White' },
  U: { bg: '#c1d7e9', fg: '#12405f', label: 'Blue' },
  B: { bg: '#bab1ab', fg: '#241c17', label: 'Black' },
  R: { bg: '#e49977', fg: '#5d1f10', label: 'Red' },
  G: { bg: '#a3c095', fg: '#1d3d21', label: 'Green' },
};

export function ColorPips({ colors }: { colors: readonly string[] }) {
  if (colors.length === 0) {
    return <span className="text-xs text-muted">Colorless</span>;
  }

  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Colors: ${colors.join(', ')}`}>
      {colors.map((color) => {
        const spec = COLORS[color];
        if (!spec) return null;
        return (
          <span
            key={color}
            title={spec.label}
            aria-hidden
            className="flex size-4 items-center justify-center rounded-full text-[9px] font-bold"
            style={{ background: spec.bg, color: spec.fg }}
          >
            {color}
          </span>
        );
      })}
    </span>
  );
}
