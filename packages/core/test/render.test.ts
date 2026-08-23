import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { computeLayout, PT_PER_MM } from '../src/layout/geometry.js';
import { renderPdf } from '../src/pdf/render.js';

/** A 1x1 red PNG, small enough to inline. */
const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const item = (key: string, quantity: number) => ({ key, bytes: PNG, quantity });

describe('renderPdf', () => {
  it('paginates at nine cards per page', async () => {
    const result = await renderPdf([item('a', 10)]);
    expect(result.cardCount).toBe(10);
    expect(result.pageCount).toBe(2);
  });

  it('embeds each distinct image exactly once', async () => {
    const result = await renderPdf([item('swamp', 7), item('sol-ring', 1)]);
    expect(result.cardCount).toBe(8);
    expect(result.uniqueImages).toBe(2);
  });

  it('produces a page at the requested paper size', async () => {
    const result = await renderPdf([item('a', 1)], { paper: 'letter' });
    const pdf = await PDFDocument.load(result.bytes);
    const page = pdf.getPage(0);
    expect(page.getWidth() / PT_PER_MM).toBeCloseTo(215.9, 6);
    expect(page.getHeight() / PT_PER_MM).toBeCloseTo(279.4, 6);
  });

  it('always emits at least one page', async () => {
    const result = await renderPdf([]);
    expect(result.pageCount).toBe(1);
    expect(result.cardCount).toBe(0);
  });

  it('accepts a prebuilt layout', async () => {
    const layout = computeLayout({ paper: 'a3' });
    const result = await renderPdf([item('a', 1)], { layout });
    expect(result.layout.perPage).toBe(layout.perPage);
  });

  it('rejects bytes that are neither PNG nor JPEG', async () => {
    await expect(
      renderPdf([{ key: 'bad', bytes: new Uint8Array([1, 2, 3, 4]), quantity: 1 }]),
    ).rejects.toThrow(/PNG or JPEG/);
  });

  it('produces a loadable PDF for every guide style', async () => {
    for (const guides of ['crop', 'lines', 'none'] as const) {
      const result = await renderPdf([item('a', 9)], { guides });
      const pdf = await PDFDocument.load(result.bytes);
      expect(pdf.getPageCount()).toBe(1);
    }
  });
});
