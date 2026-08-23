#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  PAPER_SIZES,
  computeLayout,
  diffDeck,
  isBasicLand,
  missingOnly,
  normalizeName,
  scorePrinting,
  comparePrintings,
  type GuideStyle,
  type ImageQuality,
  type PaperName,
} from '@mtgproxy/core';
import { renderPdf } from '@mtgproxy/core/pdf';
import { cacheStats, clearCache, loadCollection, loadConfig, saveConfig } from '@mtgproxy/node';
import { collectionCommand } from './collection-cmd.js';
import { fetchImages, loadDeck, makeClient, ownedKeysOf, reportResolve } from './deck.js';
import { collect, resolveProfile, type ProfileFlags } from './prefs.js';
import { bold, cyan, dim, done, fail, formatBytes, green, info, yellow } from './ui.js';

const VERSION = '0.2.0';

function choice<T extends string>(allowed: readonly T[]) {
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

/** Options shared by every command that resolves a decklist. */
function withDeckOptions(command: Command): Command {
  return command
    .option('--markdown', 'force markdown decklist-block extraction')
    .option('--quiet', 'suppress per-request logging')
    .option('-c, --collection <path>', 'collection file')
    .option('--config <path>', 'config file')
    .option('--profile <name>', 'named preference profile from the config file')
    .option('--prefer-set <code>', 'prefer this set (repeatable, ordered)', collect)
    .option('--avoid-set <code>', 'avoid this set (repeatable)', collect)
    .option('--require-set <code>', 'only use these sets (repeatable)', collect)
    .option('--full-art', 'prefer full-art printings')
    .option('--borderless', 'prefer borderless printings')
    .option('--retro', 'prefer retro-frame printings')
    .option('--frame-effect <name>', 'prefer a frame effect, e.g. showcase (repeatable)', collect)
    .option('--no-ub', 'avoid Universes Beyond printings')
    .option('--no-prefer-owned', 'do not favour printings you already own');
}

interface DeckFlags extends ProfileFlags {
  markdown?: boolean;
  quiet?: boolean;
  collection?: string;
}

/** Shared setup: load the collection and profile, then parse and resolve. */
async function prepare(file: string, flags: DeckFlags) {
  const { data: collection } = await loadCollection(flags.collection);
  const { profile, name } = await resolveProfile(flags);
  if (name) info(dim(`  profile: ${name}`));

  const config = (await loadConfig(flags.config)).data;
  const client = makeClient(flags.quiet ?? true);
  const loaded = await loadDeck(file, client, {
    markdown: flags.markdown,
    profile,
    collection,
    pins: config.pins ?? {},
  });
  return { ...loaded, collection, client, profile };
}

interface PrintFlags extends DeckFlags {
  output?: string;
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  gap: number;
  missingOnly?: boolean;
  strictPrinting?: boolean;
  assumeBasics: boolean;
}

withDeckOptions(
  program
    .command('print')
    .description('Render a decklist to a print-ready PDF')
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('-o, --output <path>', 'output PDF path (default: alongside the input)')
    .option('-p, --paper <size>', `paper size (${Object.keys(PAPER_SIZES).join(', ')})`, choice(Object.keys(PAPER_SIZES) as PaperName[]), 'a4')
    .option('-g, --guides <style>', 'cut guides: crop, lines, none', choice(['crop', 'lines', 'none'] as const), 'crop')
    .option('-q, --quality <level>', 'image quality: png, large, normal', choice(['png', 'large', 'normal'] as const), 'png')
    .option('--gap <mm>', 'gap between cards in millimetres', Number.parseFloat, 0)
    .option('-m, --missing-only', 'print only the cards not already in your collection')
    .option('--strict-printing', 'only count the exact printing as owned')
    .option('--no-assume-basics', 'do not treat basic lands as already owned'),
).action(async (file: string, flags: PrintFlags) => {
  const { resolve, collection, client } = await prepare(file, flags);
  reportResolve(resolve);
  if (resolve.resolved.length === 0) throw new Error('nothing to print: no cards resolved');

  let toPrint = resolve.resolved;
  if (flags.missingOnly) {
    const diff = diffDeck(resolve.resolved, collection, {
      strictPrinting: flags.strictPrinting ?? false,
      assumeBasics: flags.assumeBasics,
    });
    toPrint = missingOnly(resolve.resolved, diff);
    info(
      `${bold('Collection')} ${diff.totalOwned} of ${diff.totalNeeded} owned, ` +
        `${yellow(String(diff.totalMissing))} to print`,
    );
    if (toPrint.length === 0) {
      done('you already own every card in this deck; nothing to print');
      return;
    }
  }

  const { items, skipped } = await fetchImages({ ...resolve, resolved: toPrint }, client, flags.quality);
  for (const message of skipped) fail(message);

  const layout = computeLayout({ paper: flags.paper, gapMm: flags.gap });
  const result = await renderPdf(items, {
    layout,
    guides: flags.guides,
    title: `mtgproxy - ${file === '-' ? 'decklist' : basename(file)}`,
  });

  const output = resolvePath(
    flags.output ??
      (file === '-' ? 'deck.pdf' : `${file.slice(0, file.length - extname(file).length)}.pdf`),
  );
  await writeFile(output, result.bytes);

  info('');
  info(
    `${bold('Sheet')}  ${result.layout.columns}x${result.layout.rows} on ${flags.paper.toUpperCase()} ` +
      dim(`(${result.layout.paper.widthMm}x${result.layout.paper.heightMm}mm)`),
  );
  info(
    `${bold('Cards')}  ${result.cardCount} placements, ${result.uniqueImages} unique printings, ` +
      `${result.pageCount} page${result.pageCount === 1 ? '' : 's'}`,
  );
  info(`${bold('Size')}   ${formatBytes(result.bytes.length)}`);
  done(cyan(output));
  info(dim('Print at 100% scale with "fit to page" turned off.'));
});

withDeckOptions(
  program
    .command('resolve')
    .description('Match a decklist against Scryfall without generating a PDF')
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('--json', 'emit the resolution as JSON on stdout'),
).action(async (file: string, flags: DeckFlags & { json?: boolean }) => {
  const { resolve } = await prepare(file, flags);

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  reportResolve(resolve);
  info('');
  for (const item of resolve.resolved) {
    const printing = dim(`${item.card.set.toUpperCase()} ${item.card.collector_number}`);
    info(`  ${String(item.entry.quantity).padStart(2)} ${item.card.name.padEnd(34)} ${printing}`);
  }
  info('');
  info(`${resolve.resolved.length} resolved, ${resolve.unresolved.length} unresolved`);
});

withDeckOptions(
  program
    .command('diff')
    .description('Show which cards in a decklist you do not own')
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('--strict-printing', 'only count the exact printing as owned')
    .option('--no-assume-basics', 'do not treat basic lands as already owned')
    .option('--json', 'emit the diff as JSON on stdout'),
).action(
  async (
    file: string,
    flags: DeckFlags & { strictPrinting?: boolean; assumeBasics: boolean; json?: boolean },
  ) => {
    const { resolve, collection } = await prepare(file, flags);
    reportResolve(resolve);

    const diff = diffDeck(resolve.resolved, collection, {
      strictPrinting: flags.strictPrinting ?? false,
      assumeBasics: flags.assumeBasics,
    });

    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            totals: {
              needed: diff.totalNeeded,
              owned: diff.totalOwned,
              missing: diff.totalMissing,
            },
            rows: diff.rows.map((row) => ({
              name: row.card.name,
              set: row.card.set,
              collectorNumber: row.card.collector_number,
              needed: row.needed,
              owned: row.owned,
              missing: row.missing,
              isBasic: row.isBasic,
            })),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    info('');
    const missing = diff.rows.filter((row) => row.missing > 0);
    const owned = diff.rows.filter((row) => row.missing === 0);

    if (owned.length > 0) {
      info(bold(`Owned (${owned.length})`));
      for (const row of owned) {
        const note = row.isBasic ? dim(' basic') : '';
        info(`  ${green('ok')} ${String(row.needed).padStart(2)} ${row.card.name}${note}`);
      }
      info('');
    }
    if (missing.length > 0) {
      info(bold(`Missing (${missing.length})`));
      for (const row of missing) {
        const held = row.owned > 0 ? dim(` (own ${row.owned} of ${row.needed})`) : '';
        info(`  ${yellow('--')} ${String(row.missing).padStart(2)} ${row.card.name}${held}`);
      }
      info('');
    }
    info(`${diff.totalOwned} of ${diff.totalNeeded} owned, ${diff.totalMissing} missing`);
  },
);

withDeckOptions(
  program
    .command('prints')
    .description('List every printing of a card, ranked by your preferences')
    .argument('<name>', 'card name')
    .option('--explain', 'show the score breakdown for each printing')
    .option('--limit <n>', 'how many printings to show', (v) => Number.parseInt(v, 10), 15),
).action(async (name: string, flags: DeckFlags & { explain?: boolean; limit: number }) => {
  const { data: collection } = await loadCollection(flags.collection);
  const { profile, name: profileName } = await resolveProfile(flags);
  const client = makeClient(flags.quiet ?? true);

  const candidates = await client.prints(name);
  if (candidates.length === 0) throw new Error(`no Scryfall match for "${name}"`);

  const isBasic = isBasicLand(candidates[0]!);
  const ownedKeys = ownedKeysOf(collection);
  const ranked = candidates
    .map((card) => scorePrinting(card, profile, { ownedKeys, isBasic }))
    .sort(comparePrintings);

  info(
    `${bold(candidates[0]!.name)} - ${candidates.length} printings` +
      (profileName ? dim(` (profile: ${profileName})`) : '') +
      (isBasic ? dim(' [basic land policy]') : ''),
  );
  info('');

  for (const entry of ranked.slice(0, flags.limit)) {
    const tag = entry.disqualified ? yellow('x') : green('+');
    const printing = `${entry.card.set.toUpperCase()} ${entry.card.collector_number}`;
    info(
      `  ${tag} ${String(entry.score).padStart(4)}  ${printing.padEnd(12)} ` +
        `${dim(entry.card.set_name)} ${dim(entry.card.released_at)}`,
    );
    if (entry.disqualified) info(`         ${yellow(entry.disqualified)}`);
    if (flags.explain) {
      for (const reason of entry.reasons) {
        const sign = reason.delta >= 0 ? '+' : '';
        const detail = reason.detail ? dim(` ${reason.detail}`) : '';
        info(dim(`         ${sign}${reason.delta} ${reason.rule}${detail}`));
      }
    }
  }
  if (ranked.length > flags.limit) info(dim(`  ... ${ranked.length - flags.limit} more`));
});

const prefs = program.command('prefs').description('Inspect printing preference profiles');

prefs
  .command('show')
  .description('Show the effective profile')
  .option('--config <path>', 'config file')
  .option('--profile <name>', 'named profile')
  .action(async (flags: ProfileFlags) => {
    const { profile, config, configPath, name } = await resolveProfile(flags);
    info(`${bold('Config')}   ${cyan(configPath)}`);
    info(`${bold('Profile')}  ${name ?? dim('(built-in defaults only)')}`);
    const available = Object.keys(config.profiles ?? {});
    if (available.length) info(`${bold('Defined')}  ${available.join(', ')}`);
    info('');
    info(JSON.stringify(profile, null, 2));
  });

prefs
  .command('init')
  .description('Write a starter config file')
  .option('--config <path>', 'config file')
  .action(async (flags: { config?: string }) => {
    const { data, existed, path } = await loadConfig(flags.config);
    if (existed) {
      info(dim(`config already exists at ${path}; leaving it alone`));
      return;
    }
    done(`wrote ${cyan(await saveConfig(data, flags.config))}`);
  });

program
  .command('pin')
  .description('Always use a specific printing for a card')
  .argument('<name>', 'card name')
  .requiredOption('-s, --set <code>', 'set code')
  .requiredOption('-n, --number <cn>', 'collector number')
  .option('--remove', 'remove the pin instead')
  .option('--config <path>', 'config file')
  .action(async (name: string, flags: { set: string; number: string; remove?: boolean; config?: string }) => {
    const { data } = await loadConfig(flags.config);
    const key = normalizeName(name);
    const pins = { ...(data.pins ?? {}) };

    if (flags.remove) {
      delete pins[key];
      await saveConfig({ ...data, pins }, flags.config);
      done(`unpinned ${bold(name)}`);
      return;
    }

    // Confirm the printing exists before recording it, so a typo fails now
    // rather than silently falling back during the next print run.
    const client = makeClient(true);
    const found = (await client.collection([{ set: flags.set, collector_number: flags.number }])).data[0];
    if (!found) throw new Error(`no printing ${flags.set.toUpperCase()} ${flags.number}`);
    if (normalizeName(found.name) !== key) {
      throw new Error(
        `${flags.set.toUpperCase()} ${flags.number} is ${found.name}, not ${name}`,
      );
    }

    pins[key] = { set: flags.set.toLowerCase(), collectorNumber: flags.number };
    await saveConfig({ ...data, pins }, flags.config);
    done(`pinned ${bold(found.name)} to ${found.set.toUpperCase()} ${found.collector_number}`);
  });

program.addCommand(collectionCommand());

const cache = program.command('cache').description('Inspect or clear the local Scryfall cache');

cache
  .command('info')
  .description('Show cache size')
  .action(async () => {
    const stats = await cacheStats();
    for (const [label, value] of Object.entries(stats)) {
      info(`${label.padEnd(8)} ${String(value.files).padStart(6)} files  ${formatBytes(value.bytes)}`);
    }
  });

cache
  .command('clear')
  .description('Delete cached card data, printing lists and images')
  .argument('[what]', 'cards, prints, images, or all', 'all')
  .action(async (what: string) => {
    if (!['cards', 'prints', 'images', 'all'].includes(what)) {
      throw new Error(`expected cards, prints, images or all; got "${what}"`);
    }
    await clearCache(what as 'cards' | 'prints' | 'images' | 'all');
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
