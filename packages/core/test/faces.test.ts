import { describe, expect, it } from 'vitest';
import { backImageUrl, faceImageUrl, frontImageUrl } from '../src/scryfall/types.js';
import { placementCount, printPlacements } from '../src/printing/faces.js';
import type { ResolvedCard } from '../src/scryfall/resolve.js';
import { card } from './helpers.js';

/** A transforming card, which carries its images per face rather than on top. */
const transformer = (over = {}) =>
  card({
    id: 'ojer',
    name: 'Ojer Taq, Deepest Foundation // Temple of Civilization',
    layout: 'transform',
    image_uris: undefined,
    card_faces: [
      {
        name: 'Ojer Taq, Deepest Foundation',
        image_uris: { png: 'https://example.invalid/front.png', normal: 'https://example.invalid/front.jpg' },
      },
      {
        name: 'Temple of Civilization',
        image_uris: { png: 'https://example.invalid/back.png', normal: 'https://example.invalid/back.jpg' },
      },
    ],
    ...over,
  });

const resolved = (over: ReturnType<typeof card>, quantity = 1): ResolvedCard => ({
  entry: { name: over.name, quantity, line: 1, raw: `${quantity} ${over.name}` },
  card: over,
  via: 'name',
});

describe('faceImageUrl', () => {
  it('reads the front from the card itself when it has one face', () => {
    expect(frontImageUrl(card(), 'png')).toBe('https://example.invalid/card.png');
  });

  it('reads each face of a double-faced card', () => {
    const dfc = transformer();
    expect(frontImageUrl(dfc, 'png')).toBe('https://example.invalid/front.png');
    expect(backImageUrl(dfc, 'png')).toBe('https://example.invalid/back.png');
  });

  it('has no back for a single-faced card', () => {
    expect(backImageUrl(card(), 'png')).toBeNull();
  });

  it('falls back through sizes on the back face too', () => {
    const dfc = transformer();
    delete (dfc.card_faces![1].image_uris as Record<string, unknown>)['png'];
    expect(backImageUrl(dfc, 'png')).toBe('https://example.invalid/back.jpg');
  });

  it('treats a meld card as single-faced, since its back is a separate card', () => {
    const meld = card({ layout: 'meld' });
    expect(faceImageUrl(meld, 'png', 'back')).toBeNull();
  });
});

describe('printPlacements', () => {
  it('prints front faces only by default', () => {
    const { placements } = printPlacements([resolved(transformer())], { quality: 'png' });
    expect(placements).toHaveLength(1);
    expect(placements[0].side).toBe('front');
  });

  it('adds the back face when asked, directly after its front', () => {
    const { placements } = printPlacements([resolved(transformer())], {
      quality: 'png',
      bothFaces: true,
    });
    expect(placements.map((item) => item.side)).toEqual(['front', 'back']);
    expect(placements[1].url).toBe('https://example.invalid/back.png');
    // Named for the face, so the PDF metadata says which side it is.
    expect(placements[1].name).toBe('Temple of Civilization');
  });

  it('prints one back per copy', () => {
    const { placements } = printPlacements([resolved(transformer(), 3)], {
      quality: 'png',
      bothFaces: true,
    });
    expect(placements.map((item) => item.quantity)).toEqual([3, 3]);
    expect(placementCount(placements)).toBe(6);
  });

  it('leaves single-faced cards alone when both faces are asked for', () => {
    const { placements } = printPlacements([resolved(card(), 2)], {
      quality: 'png',
      bothFaces: true,
    });
    expect(placements).toHaveLength(1);
    expect(placementCount(placements)).toBe(2);
  });

  it('collapses copies of one printing into a single placement', () => {
    const plains = card({ id: 'plains', name: 'Plains' });
    const { placements } = printPlacements([resolved(plains, 10), resolved(plains, 6)], {
      quality: 'png',
    });
    expect(placements).toHaveLength(1);
    expect(placements[0].quantity).toBe(16);
  });

  it('keys each face separately so both images get embedded', () => {
    const { placements } = printPlacements([resolved(transformer())], {
      quality: 'png',
      bothFaces: true,
    });
    expect(new Set(placements.map((item) => item.key)).size).toBe(2);
  });

  it('reports a card it cannot print rather than dropping it silently', () => {
    const imageless = card({ id: 'none', image_uris: undefined });
    const { placements, skipped } = printPlacements([resolved(imageless)], { quality: 'png' });
    expect(placements).toHaveLength(0);
    expect(skipped[0]).toContain('no printable image');
  });

  it('reports a missing back face as such', () => {
    const dfc = transformer();
    delete (dfc.card_faces![1] as Record<string, unknown>)['image_uris'];
    const { placements, skipped } = printPlacements([resolved(dfc)], {
      quality: 'png',
      bothFaces: true,
    });
    expect(placements).toHaveLength(1);
    expect(skipped[0]).toContain('no printable back face');
  });
});
