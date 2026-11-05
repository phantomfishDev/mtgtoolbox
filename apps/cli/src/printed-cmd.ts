import { Command } from 'commander';
import { sortEntries, type PrintedEntry } from '@mtgproxy/core';
import { emptyLedger } from '@mtgproxy/core';
import { loadPrinted, savePrinted } from '@mtgproxy/node';
import { bold, cyan, dim, done, info, warn } from './ui.js';

/**
 * `mtgproxy printed ...`
 *
 * The ledger of printings already run off, so a print job can skip them.
 *
 * Deliberately small: entries arrive from `print --record`, which writes them
 * only after a PDF lands on disk, and leave via `clear`. There is no `add` by
 * hand, because a ledger that disagrees with what came out of the printer is
 * worse than no ledger at all.
 */

function formatEntry(entry: PrintedEntry): string {
  const finish = entry.finish === 'nonfoil' ? '' : dim(` ${entry.finish}`);
  const language = entry.language ? dim(` ${entry.language}`) : '';
  const printing = dim(`${entry.set.toUpperCase()} ${entry.collectorNumber}`);
  const note = entry.note ? dim(`  ${entry.note}`) : '';
  return `  ${String(entry.quantity).padStart(3)} ${entry.name.padEnd(36)} ${printing}${finish}${language}${note}`;
}

function totals(cards: readonly PrintedEntry[]): { cards: number; names: number } {
  return {
    cards: cards.reduce((sum, entry) => sum + entry.quantity, 0),
    names: new Set(cards.map((entry) => entry.name.toLowerCase())).size,
  };
}

export function printedCommand(): Command {
  const printed = new Command('printed')
    .description('The ledger of cards you have already printed')
    .option('--printed <path>', 'ledger file (default: ~/.config/mtgproxy/printed.json)');

  const filePath = (command: Command): string | undefined =>
    command.parent?.opts<{ printed?: string }>().printed;

  printed
    .command('list')
    .alias('ls')
    .description('List everything recorded as printed')
    .option('--json', 'emit JSON')
    .action(async function (this: Command, options) {
      const { data, existed, path } = await loadPrinted(filePath(this));
      if (options.json) {
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return;
      }
      if (!existed) {
        info(dim(`nothing printed yet; no ledger at ${path}`));
        return;
      }
      for (const entry of sortEntries(data.cards)) info(formatEntry(entry));
      const { cards, names } = totals(data.cards);
      info('');
      info(`${cards} cards printed, ${names} distinct names`);
    });

  printed
    .command('path')
    .description('Print the ledger file path')
    .action(async function (this: Command) {
      const { path } = await loadPrinted(filePath(this));
      process.stdout.write(`${path}\n`);
    });

  printed
    .command('clear')
    .description('Forget everything in the ledger')
    .option('-y, --yes', 'actually do it')
    .action(async function (this: Command, options: { yes?: boolean }) {
      const { data, existed, path } = await loadPrinted(filePath(this));
      if (!existed || data.cards.length === 0) {
        info(dim(`nothing to clear at ${path}`));
        return;
      }
      const { cards, names } = totals(data.cards);
      if (!options.yes) {
        warn(`this would forget ${cards} printed cards (${names} names) at ${path}`);
        info(dim('  nothing was changed; pass --yes to go ahead'));
        return;
      }
      const written = await savePrinted(emptyLedger(), filePath(this));
      done(`cleared ${bold(String(cards))} printed cards from ${cyan(written)}`);
    });

  return printed;
}
