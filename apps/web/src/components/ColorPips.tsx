import { useState } from 'react';

/**
 * A deck's colour identity as Magic's five mana symbols.
 *
 * The symbols are Scryfall's own SVGs, referenced by URL rather than copied in,
 * which is the rule the rest of the project follows for card images: only ever
 * the URL, never the bytes.
 *
 * Each pip is a coloured disc with its letter in it, and the symbol is laid
 * over the top once it has loaded. That is what makes the component safe with
 * no network: a symbol that fails to load is removed, revealing the letter pip
 * underneath, so colour identity degrades to legible rather than to a row of
 * broken images. An empty `alt` is not enough on its own — a broken image with
 * a forced size still paints the browser's placeholder icon over the letter.
 *
 * It also means identity never rests on colour alone, which matters because
 * white and black are separated mostly by luminance.
 */
const COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  W: { bg: '#f8f6d8', fg: '#3a3520', label: 'White' },
  U: { bg: '#c1d7e9', fg: '#12405f', label: 'Blue' },
  B: { bg: '#bab1ab', fg: '#241c17', label: 'Black' },
  R: { bg: '#e49977', fg: '#5d1f10', label: 'Red' },
  G: { bg: '#a3c095', fg: '#1d3d21', label: 'Green' },
};

/** Scryfall serves one SVG per card symbol, at a stable path per letter. */
function symbolUrl(color: string): string {
  return `https://svgs.scryfall.io/card-symbols/${color}.svg`;
}

function Pip({ color, spec }: { color: string; spec: { bg: string; fg: string; label: string } }) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      title={spec.label}
      aria-hidden
      className="relative flex size-4 items-center justify-center rounded-full text-[9px] font-bold"
      style={{ background: spec.bg, color: spec.fg }}
    >
      {color}
      {!failed && (
        <img
          src={symbolUrl(color)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full rounded-full"
        />
      )}
    </span>
  );
}

export function ColorPips({ colors }: { colors: readonly string[] }) {
  if (colors.length === 0) {
    return <span className="text-xs text-muted">Colorless</span>;
  }

  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Colors: ${colors.join(', ')}`}>
      {colors.map((color) => {
        const spec = COLORS[color];
        return spec ? <Pip key={color} color={color} spec={spec} /> : null;
      })}
    </span>
  );
}
