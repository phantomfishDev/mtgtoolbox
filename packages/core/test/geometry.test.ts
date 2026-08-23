import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT_MM,
  CARD_WIDTH_MM,
  PT_PER_MM,
  computeLayout,
  mmToPt,
} from '../src/layout/geometry.js';

const ptToMm = (pt: number) => pt / PT_PER_MM;

describe('computeLayout', () => {
  it('converts millimetres to points at 72dpi', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 10);
  });

  it('fits a 3x3 grid on A4 with centred margins', () => {
    const layout = computeLayout({ paper: 'a4' });
    expect([layout.columns, layout.rows]).toEqual([3, 3]);
    expect(layout.perPage).toBe(9);
    expect(ptToMm(layout.marginX)).toBeCloseTo(10.5, 6);
    expect(ptToMm(layout.marginY)).toBeCloseTo(16.5, 6);
  });

  it('fits a 3x3 grid on Letter', () => {
    const layout = computeLayout({ paper: 'letter' });
    expect([layout.columns, layout.rows]).toEqual([3, 3]);
    expect(ptToMm(layout.marginX)).toBeCloseTo(13.45, 6);
    expect(ptToMm(layout.marginY)).toBeCloseTo(7.7, 6);
  });

  it('keeps cards at exactly true size', () => {
    const layout = computeLayout();
    expect(ptToMm(layout.cardWidth)).toBeCloseTo(CARD_WIDTH_MM, 10);
    expect(ptToMm(layout.cardHeight)).toBeCloseTo(CARD_HEIGHT_MM, 10);
  });

  it('never scales cards down to force a larger grid', () => {
    // A gap wide enough to push the third column off the sheet must drop the
    // column, not shrink the cards.
    const layout = computeLayout({ paper: 'a4', gapMm: 12 });
    expect(layout.columns).toBe(2);
    expect(ptToMm(layout.cardWidth)).toBeCloseTo(CARD_WIDTH_MM, 10);
  });

  it('lays slots out left to right, top to bottom', () => {
    const layout = computeLayout();
    const first = layout.slots[0]!;
    const second = layout.slots[1]!;
    const fourth = layout.slots[3]!;
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBe(first.y);
    // Row 1 sits below row 0, so its bottom edge has a smaller y.
    expect(fourth.y).toBeLessThan(first.y);
  });

  it('keeps every slot inside the page', () => {
    for (const paper of ['a4', 'letter', 'legal', 'a3'] as const) {
      const layout = computeLayout({ paper });
      for (const slot of layout.slots) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.x + slot.width).toBeLessThanOrEqual(layout.pageWidth + 1e-9);
        expect(slot.y + slot.height).toBeLessThanOrEqual(layout.pageHeight + 1e-9);
      }
    }
  });

  it('emits one cut line per grid edge when cards are tiled', () => {
    const layout = computeLayout({ paper: 'a4', gapMm: 0 });
    expect(layout.cutXs).toHaveLength(4);
    expect(layout.cutYs).toHaveLength(4);
  });

  it('emits both edges of each gutter when cards are spaced', () => {
    const layout = computeLayout({ paper: 'a3', gapMm: 4 });
    // Outer edges plus two per interior gutter.
    expect(layout.cutXs).toHaveLength(2 + (layout.columns - 1) * 2);
  });

  it('fits more cards on A3', () => {
    expect(computeLayout({ paper: 'a3' }).perPage).toBeGreaterThan(9);
  });
});
