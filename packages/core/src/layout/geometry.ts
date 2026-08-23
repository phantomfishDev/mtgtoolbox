/**
 * Page geometry for proxy sheets.
 *
 * Everything is computed in millimetres and converted to PostScript points at
 * the boundary, because card and paper dimensions are only ever quoted in mm
 * and doing the arithmetic in points invites rounding drift.
 */

/** PostScript points per millimetre (72 pt/inch, 25.4 mm/inch). */
export const PT_PER_MM = 72 / 25.4;

export const mmToPt = (mm: number): number => mm * PT_PER_MM;

/** True Magic card dimensions. */
export const CARD_WIDTH_MM = 63;
export const CARD_HEIGHT_MM = 88;

export interface PaperSize {
  readonly widthMm: number;
  readonly heightMm: number;
}

export const PAPER_SIZES = {
  a4: { widthMm: 210, heightMm: 297 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
  legal: { widthMm: 215.9, heightMm: 355.6 },
  a3: { widthMm: 297, heightMm: 420 },
} as const satisfies Record<string, PaperSize>;

export type PaperName = keyof typeof PAPER_SIZES;

export type GuideStyle = 'crop' | 'lines' | 'none';

export interface LayoutOptions {
  paper?: PaperName | PaperSize;
  /** Gap between cards. Zero tiles them so one cut serves two cards. */
  gapMm?: number;
  cardWidthMm?: number;
  cardHeightMm?: number;
  /** Minimum margin to keep clear; most printers cannot print to the edge. */
  minMarginMm?: number;
}

/** A card slot on a page, in points, with a bottom-left origin as PDF expects. */
export interface Slot {
  readonly column: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Layout {
  readonly paper: PaperSize;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly perPage: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly gap: number;
  readonly marginX: number;
  readonly marginY: number;
  /** Slots in reading order: left to right, top to bottom. */
  readonly slots: readonly Slot[];
  /** Grid line positions in points, for drawing cut guides. */
  readonly cutXs: readonly number[];
  readonly cutYs: readonly number[];
}

function resolvePaper(paper: LayoutOptions['paper']): PaperSize {
  if (paper === undefined) return PAPER_SIZES.a4;
  if (typeof paper === 'string') {
    const found = PAPER_SIZES[paper];
    if (!found) throw new Error(`unknown paper size "${paper}"`);
    return found;
  }
  return paper;
}

/**
 * Fit as many true-size cards on the sheet as will fit, centred.
 *
 * Cards are never scaled — if they do not fit, fewer go on the page. A proxy
 * printed at 97% is a wasted sheet, so the grid gives way instead.
 */
export function computeLayout(options: LayoutOptions = {}): Layout {
  const paper = resolvePaper(options.paper);
  const cardWidthMm = options.cardWidthMm ?? CARD_WIDTH_MM;
  const cardHeightMm = options.cardHeightMm ?? CARD_HEIGHT_MM;
  const gapMm = options.gapMm ?? 0;
  const minMarginMm = options.minMarginMm ?? 5;

  const usableWidth = paper.widthMm - minMarginMm * 2;
  const usableHeight = paper.heightMm - minMarginMm * 2;

  const columns = Math.max(
    1,
    Math.floor((usableWidth + gapMm) / (cardWidthMm + gapMm)),
  );
  const rows = Math.max(1, Math.floor((usableHeight + gapMm) / (cardHeightMm + gapMm)));

  const gridWidthMm = columns * cardWidthMm + (columns - 1) * gapMm;
  const gridHeightMm = rows * cardHeightMm + (rows - 1) * gapMm;
  const marginXMm = (paper.widthMm - gridWidthMm) / 2;
  const marginYMm = (paper.heightMm - gridHeightMm) / 2;

  const cardWidth = mmToPt(cardWidthMm);
  const cardHeight = mmToPt(cardHeightMm);
  const gap = mmToPt(gapMm);
  const marginX = mmToPt(marginXMm);
  const marginY = mmToPt(marginYMm);
  const pageHeight = mmToPt(paper.heightMm);

  const slots: Slot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = marginX + column * (cardWidth + gap);
      // Rows count from the top of the page; PDF y counts from the bottom.
      const topY = pageHeight - marginY - row * (cardHeight + gap);
      slots.push({ column, row, x, y: topY - cardHeight, width: cardWidth, height: cardHeight });
    }
  }

  const cutXs: number[] = [];
  for (let column = 0; column <= columns; column++) {
    const edge = marginX + column * (cardWidth + gap);
    cutXs.push(gap > 0 && column > 0 ? edge - gap : edge);
    if (gap > 0 && column > 0 && column < columns) cutXs.push(edge);
  }
  const cutYs: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const edge = pageHeight - marginY - row * (cardHeight + gap);
    cutYs.push(gap > 0 && row > 0 ? edge + gap : edge);
    if (gap > 0 && row > 0 && row < rows) cutYs.push(edge);
  }

  return {
    paper,
    pageWidth: mmToPt(paper.widthMm),
    pageHeight,
    columns,
    rows,
    perPage: columns * rows,
    cardWidth,
    cardHeight,
    gap,
    marginX,
    marginY,
    slots,
    cutXs: [...new Set(cutXs)].sort((a, b) => a - b),
    cutYs: [...new Set(cutYs)].sort((a, b) => a - b),
  };
}
