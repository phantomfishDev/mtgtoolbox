import { PDFDocument, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  computeLayout,
  mmToPt,
  type GuideStyle,
  type Layout,
  type LayoutOptions,
} from '../layout/geometry.js';

/** One card to place, with how many copies of it the sheet needs. */
export interface PrintItem {
  /** Stable identity used to embed each distinct image exactly once. */
  key: string;
  bytes: Uint8Array;
  quantity: number;
  /** Card name, used only for PDF metadata. */
  name?: string;
}

export interface RenderOptions extends LayoutOptions {
  guides?: GuideStyle;
  /** Grey level for guide lines, 0 = black, 1 = white. */
  guideGrey?: number;
  guideWidthMm?: number;
  /** Length of each crop mark, measured outward from the grid edge. */
  cropMarkLengthMm?: number;
  title?: string;
  layout?: Layout;
}

export interface RenderResult {
  bytes: Uint8Array;
  layout: Layout;
  pageCount: number;
  cardCount: number;
  /** Distinct images embedded, as opposed to total placements. */
  uniqueImages: number;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

async function embed(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  if (startsWith(bytes, PNG_MAGIC)) return pdf.embedPng(bytes);
  if (startsWith(bytes, JPEG_MAGIC)) return pdf.embedJpg(bytes);
  throw new Error('unsupported image format: expected PNG or JPEG');
}

function drawGuides(page: PDFPage, layout: Layout, options: Required<Pick<RenderOptions, 'guides' | 'guideGrey' | 'guideWidthMm' | 'cropMarkLengthMm'>>): void {
  if (options.guides === 'none') return;

  const colour = rgb(options.guideGrey, options.guideGrey, options.guideGrey);
  const thickness = mmToPt(options.guideWidthMm);
  const mark = mmToPt(options.cropMarkLengthMm);

  const left = Math.min(...layout.cutXs);
  const right = Math.max(...layout.cutXs);
  const bottom = Math.min(...layout.cutYs);
  const top = Math.max(...layout.cutYs);

  const line = (start: [number, number], end: [number, number]): void => {
    page.drawLine({ start: { x: start[0], y: start[1] }, end: { x: end[0], y: end[1] }, thickness, color: colour });
  };

  if (options.guides === 'lines') {
    // Full-length rules across the sheet. Easiest to follow with a guillotine,
    // but they cross the card faces.
    for (const x of layout.cutXs) line([x, 0], [x, layout.pageHeight]);
    for (const y of layout.cutYs) line([0, y], [layout.pageWidth, y]);
    return;
  }

  // 'crop': marks live entirely in the margins, leaving card faces untouched.
  for (const x of layout.cutXs) {
    line([x, bottom - mark], [x, bottom]);
    line([x, top], [x, top + mark]);
  }
  for (const y of layout.cutYs) {
    line([left - mark, y], [left, y]);
    line([right, y], [right + mark, y]);
  }
}

/**
 * Render cards onto print sheets.
 *
 * Each distinct image is embedded once and referenced by every placement, which
 * is what keeps a deck running seven copies of one basic land from carrying
 * seven copies of its artwork.
 */
export async function renderPdf(
  items: readonly PrintItem[],
  options: RenderOptions = {},
): Promise<RenderResult> {
  const layout = options.layout ?? computeLayout(options);
  const guideOptions = {
    guides: options.guides ?? 'crop',
    guideGrey: options.guideGrey ?? 0.75,
    guideWidthMm: options.guideWidthMm ?? 0.2,
    cropMarkLengthMm: options.cropMarkLengthMm ?? 4,
  };

  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title ?? 'mtgtoolbox print sheet');
  pdf.setProducer('mtgtoolbox');
  pdf.setCreator('mtgtoolbox');

  const embedded = new Map<string, PDFImage>();
  const placements: PDFImage[] = [];
  for (const item of items) {
    let image = embedded.get(item.key);
    if (!image) {
      image = await embed(pdf, item.bytes);
      embedded.set(item.key, image);
    }
    for (let copy = 0; copy < item.quantity; copy++) placements.push(image);
  }

  const pageCount = Math.max(1, Math.ceil(placements.length / layout.perPage));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
    const pageItems = placements.slice(pageIndex * layout.perPage, (pageIndex + 1) * layout.perPage);
    for (const [slotIndex, image] of pageItems.entries()) {
      const slot = layout.slots[slotIndex];
      if (!slot) continue;
      page.drawImage(image, { x: slot.x, y: slot.y, width: slot.width, height: slot.height });
    }
    drawGuides(page, layout, guideOptions);
  }

  return {
    bytes: await pdf.save(),
    layout,
    pageCount,
    cardCount: placements.length,
    uniqueImages: embedded.size,
  };
}
