#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  PAPER_SIZES,
  computeLayout,
  renderPdf,
  type GuideStyle,
  type ImageQuality,
  type PaperName,
} from '@mtgproxy/core';
import { cacheStats, clearCache } from '@mtgproxy/node';
import { fetchImages, loadDeck, makeClient, reportResolve } from './deck.js';
import { bold, cyan, dim, done, fail, formatBytes, info } from './ui.js';

const VERSION = '0.1.0';

function choice<T extends string>(name: string, allowed: readonly T[]) {
  return (value: string): T => {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new InvalidArgumentError(`expected one of: ${allowed.join(', ')}`);
    }
    return value as T;
  };
}

const program = new Command();
program
  .name('mtgproxy')
  .description('Generate print-ready proxy sheets from a Magic decklist.')
  .version(VERSION);

interface PrintOptions {
  output?: string;
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  gap: number;
  markdown?: boolean;
  quiet?: boolean;
}

program
  .command('print')
  .description('Render a decklist to a print-ready PDF')
  .argument('<file>', 'decklist file, or - to read stdin')
  .option('-o, --output <path>', 'output PDF path (default: alongside the input)')
  .option('-p, --paper <size>', `paper size (${Object.keys(PAPER_SIZES).join(', ')})`, choice('paper', Object.keys(PAPER_SIZES) as PaperName[]), 'a4')
  .option('-g, --guides <style>', 'cut guides: crop, lines, none', choice('guides', ['crop', 'lines', 'none'] as const), 'crop')
  .option('-q, --quality <level>', 'image quality: png, large, normal', choice('quality', ['png', 'large', 'normal'] as const), 'png')
  .option('--gap <mm>', 'gap between cards in millimetres', (value) => Number.parseFloat(value), 0)
  .option('--markdown', 'force markdown decklist-block extraction')
  .option('--quiet', 'suppress per-request logging')
  .action(async (file: string, options: PrintOptions) => {
    const client = makeClient(options.quiet ?? false);
    const { resolve } = await loadDeck(file, client, { markdown: options.markdown });
    reportResolve(resolve);

    if (resolve.resolved.length === 0) {
      throw new Error('nothing to print: no cards resolved');
    }

    const { items, skipped } = await fetchImages(resolve, client, options.quality);
    for (const message of skipped) fail(message);

    const layout = computeLayout({ paper: options.paper, gapMm: options.gap });
    const result = await renderPdf(items, {
      layout,
      guides: options.guides,
      title: `mtgproxy - ${file === '-' ? 'decklist' : basename(file)}`,
    });

    const output = resolvePath(
      options.output ??
        (file === '-' ? 'deck.pdf' : `${file.slice(0, file.length - extname(file).length)}.pdf`),
    );
    await writeFile(output, result.bytes);

    info('');
    info(
      `${bold('Sheet')}  ${result.layout.columns}x${result.layout.rows} on ${options.paper.toUpperCase()} ` +
        dim(`(${result.layout.paper.widthMm}x${result.layout.paper.heightMm}mm)`),
    );
    info(
      `${bold('Cards')}  ${result.cardCount} placements, ${result.uniqueImages} unique printings, ${result.pageCount} pages`,
    );
    info(`${bold('Size')}   ${formatBytes(result.bytes.length)}`);
    done(cyan(output));
    info(dim('Print at 100% scale with "fit to page" turned off.'));
  });

program
  .command('resolve')
  .description('Match a decklist against Scryfall without generating a PDF')
  .argument('<file>', 'decklist file, or - to read stdin')
  .option('--markdown', 'force markdown decklist-block extraction')
  .option('--json', 'emit the resolution as JSON on stdout')
  .option('--quiet', 'suppress per-request logging')
  .action(async (file: string, options: { markdown?: boolean; json?: boolean; quiet?: boolean }) => {
    const client = makeClient(options.quiet ?? true);
    const { resolve } = await loadDeck(file, client, { markdown: options.markdown });

    if (options.json) {
      const payload = {
        resolved: resolve.resolved.map((item) => ({
          quantity: item.entry.quantity,
          name: item.card.name,
          set: item.card.set,
          collectorNumber: item.card.collector_number,
          scryfallId: item.card.id,
          imageStatus: item.card.image_status,
          via: item.via,
        })),
        unresolved: resolve.unresolved.map((item) => ({
          name: item.entry.name,
          line: item.entry.line,
          reason: item.reason,
        })),
        warnings: resolve.warnings.map((w) => ({ code: w.code, message: w.message })),
      };
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    reportResolve(resolve);
    info('');
    for (const item of resolve.resolved) {
      const printing = dim(`${item.card.set.toUpperCase()} ${item.card.collector_number}`);
      const flag = item.via === 'fuzzy' ? dim(' ~fuzzy') : '';
      info(`  ${String(item.entry.quantity).padStart(2)} ${item.card.name.padEnd(34)} ${printing}${flag}`);
    }
    info('');
    info(`${resolve.resolved.length} resolved, ${resolve.unresolved.length} unresolved`);
  });

const cache = program.command('cache').description('Inspect or clear the local Scryfall cache');

cache
  .command('info')
  .description('Show cache size')
  .action(async () => {
    const stats = await cacheStats();
    info(`cards   ${String(stats.cards.files).padStart(6)} files  ${formatBytes(stats.cards.bytes)}`);
    info(`images  ${String(stats.images.files).padStart(6)} files  ${formatBytes(stats.images.bytes)}`);
  });

cache
  .command('clear')
  .description('Delete cached card data and images')
  .argument('[what]', 'cards, images, or all', 'all')
  .action(async (what: string) => {
    if (!['cards', 'images', 'all'].includes(what)) {
      throw new Error(`expected cards, images or all; got "${what}"`);
    }
    await clearCache(what as 'cards' | 'images' | 'all');
    done(`cleared ${what}`);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
