#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  PAPER_SIZES,
  computeLayout,
  diffDeck,
  assessBracket,
  buildDeckData,
  buildDeckIndex,
  buildDeckIndexEntry,
  isBasicLand,
  mergeEntries,
  parseDecklist,
  selectForTokenMode,
  setTokensSection,
  tokenParts,
  TOKEN_MODES,
  type TokenMode,
  refreshDeckData,
  resolveFromDeckData,
  totalCards,
  type DeckIndexEntry,
  manaCurve,
  unprintedOnly,
  addEntries,
  entryFromCard,
  normalizeName,
  scorePrinting,
  comparePrintings,
  type GuideStyle,
  type ImageQuality,
  type PaperName,
} from '@mtgproxy/core';
import { renderPdf } from '@mtgproxy/core/pdf';
import { serve } from './serve.js';
import {
  DECK_DATA_SUFFIX,
  adoptDeck,
  loadDeckData,
  saveDeckIndex,
  cacheStats,
  clearCache,
  printedPath,
  configPath,
  deckId,
  decksDir,
  listDecks,
  loadPrinted,
  loadConfig,
  savePrinted,
  saveConfig,
  saveDeckData,
} from '@mtgproxy/node';
import { printedCommand } from './printed-cmd.js';
import { workshopCommand } from './workshop/index.js';
import {
  fetchImages,
  loadDeck,
  makeClient,
  readDeckSource,
  reportResolve,
} from './deck.js';
import { collect, resolveProfile, type ProfileFlags } from './prefs.js';
import { bold, cyan, dim, done, fail, formatBytes, green, info, warn, yellow } from './ui.js';

const VERSION = '0.2.0';

/**
 * Request gap used by `sync`.
 *
 * Syncing every deck is hundreds of requests back to back, and sustained work
 * at the interactive rate earns a 429 whose Retry-After is a full minute. Being
 * slower per request is far cheaper than paying that repeatedly.
 */
const SYNC_RATE_LIMIT_MS = 350;

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
    .option('--printed <path>', 'printed-ledger file')
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
    .option(
      '--tokens <mode>',
      `what to do with the decklist's Tokens section (${TOKEN_MODES.join(', ')})`,
      choice(TOKEN_MODES as readonly TokenMode[]),
      'exclude',
    );
}

interface DeckFlags extends ProfileFlags {
  markdown?: boolean;
  quiet?: boolean;
  printed?: string;
  tokens?: TokenMode;
}

/** Shared setup: load the printed ledger and profile, then parse and resolve. */
async function prepare(file: string, flags: DeckFlags) {
  const { data: printed } = await loadPrinted(flags.printed);
  const { profile, name } = await resolveProfile(flags);
  if (name) info(dim(`  profile: ${name}`));

  const config = (await loadConfig(flags.config)).data;
  const client = makeClient(flags.quiet ?? true);
  const loaded = await loadDeck(file, client, {
    markdown: flags.markdown,
    profile,
    tokenMode: flags.tokens ?? 'exclude',
    pins: config.pins ?? {},
  });
  return { ...loaded, printed, client, profile };
}

interface PrintFlags extends DeckFlags {
  output?: string;
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  gap: number;
  unprinted?: boolean;
  record?: boolean;
  strictPrinting: boolean;
  assumeBasics?: boolean;
  bothFaces?: boolean;
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
    .option('-u, --unprinted', 'print only the cards you have not printed yet')
    .option('--record', 'record what was printed, so --unprinted skips it next time')
    .option('--both-faces', 'also print the back of each double-faced card')
    .option('--no-strict-printing', 'count any printing of a card as already printed')
    .option('--assume-basics', 'treat basic lands as already printed'),
).action(async (file: string, flags: PrintFlags) => {
  const { resolve, printed, client } = await prepare(file, flags);
  reportResolve(resolve, { bothFaces: flags.bothFaces ?? false });
  if (resolve.resolved.length === 0) throw new Error('nothing to print: no cards resolved');

  let toPrint = resolve.resolved;
  if (flags.unprinted) {
    const diff = diffDeck(resolve.resolved, printed, {
      strictPrinting: flags.strictPrinting,
      assumeBasics: flags.assumeBasics ?? false,
    });
    toPrint = unprintedOnly(resolve.resolved, diff);
    info(
      `${bold('Printed')} ${diff.totalPrinted} of ${diff.totalNeeded} already printed, ` +
        `${yellow(String(diff.totalToPrint))} to print`,
    );
    if (toPrint.length === 0) {
      done('you have already printed every card in this deck; nothing to print');
      return;
    }
  }

  const { items, skipped } = await fetchImages(
    { ...resolve, resolved: toPrint },
    client,
    flags.quality,
    flags.bothFaces ?? false,
  );
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

  // Recorded only now, after the PDF exists: a run that failed earlier must not
  // leave the ledger claiming those cards came out of the printer.
  if (flags.record) {
    const { data: ledger } = await loadPrinted(flags.printed);
    const entries = toPrint.map((item) =>
      entryFromCard(item.card, {
        quantity: item.entry.quantity,
        note: `${file === '-' ? 'decklist' : basename(file)}`,
      }),
    );
    const ledgerPath = await savePrinted(addEntries(ledger, entries), flags.printed);
    const recorded = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    info(`${bold('Recorded')} ${recorded} cards as printed ${dim(ledgerPath)}`);
  }

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
    .description('Show which cards in a decklist you have not printed yet')
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('--no-strict-printing', 'count any printing of a card as already printed')
    .option('--assume-basics', 'treat basic lands as already printed')
    .option('--json', 'emit the diff as JSON on stdout'),
).action(
  async (
    file: string,
    flags: DeckFlags & { strictPrinting: boolean; assumeBasics?: boolean; json?: boolean },
  ) => {
    const { resolve, printed } = await prepare(file, flags);
    reportResolve(resolve);

    const diff = diffDeck(resolve.resolved, printed, {
      strictPrinting: flags.strictPrinting,
      assumeBasics: flags.assumeBasics ?? false,
    });

    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            totals: {
              needed: diff.totalNeeded,
              printed: diff.totalPrinted,
              toPrint: diff.totalToPrint,
            },
            rows: diff.rows.map((row) => ({
              name: row.card.name,
              set: row.card.set,
              collectorNumber: row.card.collector_number,
              needed: row.needed,
              printed: row.printed,
              toPrint: row.toPrint,
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
    const toPrint = diff.rows.filter((row) => row.toPrint > 0);
    const alreadyPrinted = diff.rows.filter((row) => row.toPrint === 0);

    if (alreadyPrinted.length > 0) {
      info(bold(`Already printed (${alreadyPrinted.length})`));
      for (const row of alreadyPrinted) {
        const note = row.isBasic ? dim(' basic') : '';
        info(`  ${green('ok')} ${String(row.needed).padStart(2)} ${row.card.name}${note}`);
      }
      info('');
    }
    if (toPrint.length > 0) {
      info(bold(`Still to print (${toPrint.length})`));
      for (const row of toPrint) {
        const held = row.printed > 0 ? dim(` (printed ${row.printed} of ${row.needed})`) : '';
        info(`  ${yellow('--')} ${String(row.toPrint).padStart(2)} ${row.card.name}${held}`);
      }
      info('');
    }
    info(
      `${diff.totalPrinted} of ${diff.totalNeeded} already printed, ` +
        `${diff.totalToPrint} still to print`,
    );
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
  const { profile, name: profileName } = await resolveProfile(flags);
  const client = makeClient(flags.quiet ?? true);

  const candidates = await client.prints(name);
  if (candidates.length === 0) throw new Error(`no Scryfall match for "${name}"`);

  const isBasic = isBasicLand(candidates[0]!);
  const ranked = candidates
    .map((card) => scorePrinting(card, profile, { isBasic }))
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

withDeckOptions(
  program
    .command('curve')
    .description('Show the mana curve of a decklist')
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('--json', 'emit the curve as JSON on stdout'),
).action(async (file: string, flags: DeckFlags & { json?: boolean }) => {
  const { resolve } = await prepare(file, flags);
  reportResolve(resolve);
  const curve = manaCurve(resolve.resolved);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(curve, null, 2)}\n`);
    return;
  }

  info('');
  info(
    `${bold('Curve')}  ${curve.spells} spells, ${curve.lands} lands, ` +
      `average mana value ${curve.averageManaValue.toFixed(2)}`,
  );
  info('');

  // Scale bars to the widest bucket so the shape is readable at any deck size.
  const width = 40;
  for (const bucket of curve.buckets) {
    const filled = curve.peak === 0 ? 0 : Math.round((bucket.count / curve.peak) * width);
    const bar = '#'.repeat(filled).padEnd(width, ' ');
    info(`  ${bucket.label.padStart(2)}  ${cyan(bar)} ${String(bucket.count).padStart(3)}`);
  }

  if (curve.caveats.length > 0) {
    info('');
    info(bold('Where the printed curve misleads'));
    for (const caveat of curve.caveats) {
      info(`  ${yellow('-')} ${caveat.message}`);
      info(dim(`      ${caveat.cards.join(', ')}`));
    }
  }
});

withDeckOptions(
  program
    .command('bracket')
    .description('Assess which Commander bracket a decklist sits in, and why')
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('--json', 'emit the assessment as JSON on stdout'),
).action(async (file: string, flags: DeckFlags & { json?: boolean }) => {
  const { resolve } = await prepare(file, flags);
  reportResolve(resolve);
  const assessment = assessBracket(resolve.resolved);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
    return;
  }

  info('');
  info(`${bold('Bracket')}  ${cyan(`${assessment.bracket} - ${assessment.name}`)}`);
  info(dim(`  ${assessment.summary}`));

  if (assessment.signals.length > 0) {
    info('');
    info(bold('Why'));
    for (const signal of assessment.signals) {
      info(`  ${yellow('-')} ${signal.explanation}`);
      info(dim(`      ${signal.cards.join(', ')}`));
    }
  }

  info('');
  info(bold('Not checked'));
  for (const note of assessment.unchecked) info(dim(`  - ${note}`));
});

withDeckOptions(
  program
    .command('sync')
    .description('Store card data beside each decklist so it need not be re-fetched')
    .argument('[files...]', 'decklists to sync; defaults to every deck in the decks directory')
    .option('--decks <dir>', 'decks directory (default: ./examples)')
    .option('-f, --force', 're-resolve even when stored data is already current')
    .option(
      '--rate <ms>',
      'gap between requests; syncing many decks is bulk work and a 429 costs a full minute',
      (value) => Number.parseInt(value, 10),
      SYNC_RATE_LIMIT_MS,
    )
    .option(
      '--refresh',
      're-fetch the already chosen printings by id, to pick up newly stored card fields',
    ),
).action(
  async (
    files: string[],
    flags: DeckFlags & { decks?: string; force?: boolean; rate: number; refresh?: boolean },
  ) => {
    const dir = decksDir(flags.decks);
    const { profile } = await resolveProfile(flags);
    const config = (await loadConfig(flags.config)).data;
    const client = makeClient(true, flags.rate);

    // A file given from outside the decks directory is a new deck: copy it in
    // so its data has somewhere to live beside it.
    const targets: string[] = [];
    for (const file of files.length > 0 ? files : await listDecks(dir)) {
      const adopted = await adoptDeck(file, dir);
      if (resolvePath(adopted) !== resolvePath(file)) done(`added ${cyan(adopted)}`);
      targets.push(adopted);
    }

    if (targets.length === 0) {
      info(dim(`no decklists found in ${dir}`));
      return;
    }

    let written = 0;
    const indexEntries: DeckIndexEntry[] = [];

    for (const target of targets) {
      const name = deckId(target);
      try {
        const source = await readDeckSource(target);
        const parsed = parseDecklist(source.text, { markdown: source.markdown });
        const merged = mergeEntries(selectForTokenMode(parsed.entries, 'include'));
        const cardCount = totalCards(parsed.entries);

        let data = null;
        let resolved = null;

        // Refresh keeps the chosen printings and only re-reads the card data
        // for them, which is one request per 75 cards rather than per card.
        const stored = flags.refresh ? await loadDeckData(target) : null;
        if (stored) {
          const ids = stored.cards.map((card) => ({ id: card.id }));
          const fresh = await client.collection(ids);
          data = refreshDeckData(stored, fresh.data);
          resolved = resolveFromDeckData(merged, data, profile)?.result.resolved ?? null;
        }

        if (!data || !resolved) {
          const loaded = await loadDeck(target, client, {
            profile,
            // Store tokens too, so `--tokens include` and `--tokens only` are
            // served from the file rather than hitting the network.
            tokenMode: 'include',
            pins: config.pins ?? {},
            ignoreStored: (flags.force ?? false) || (flags.refresh ?? false),
          });
          if (loaded.resolve.unresolved.length > 0) {
            for (const item of loaded.resolve.unresolved) fail(`${name}: ${item.reason}`);
            info(yellow(`${name}: skipped, ${loaded.resolve.unresolved.length} card(s) unresolved`));
            continue;
          }
          // A missed pin is the one warning worth breaking sync's quiet for: it
          // means the stored file is about to disagree with the decklist, and
          // the file is what every later run reads. The noisier warnings
          // (lowres scans, double faces) stay out of a ten-deck run.
          for (const warning of loaded.resolve.warnings) {
            if (warning.code === 'pin-missed') warn(`${name}: ${warning.message}`);
          }
          resolved = loaded.resolve.resolved;
          data = buildDeckData(name, resolved, profile);
        }

        const changed = await saveDeckData(target, data);
        written += changed ? 1 : 0;
        indexEntries.push(buildDeckIndexEntry(name, parsed.entries, resolved, cardCount));
        info(
          `  ${changed ? green('updated') : dim('current')} ${name.padEnd(24)} ` +
            dim(`${data.cards.length} printings`),
        );
      } catch (error) {
        fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const indexChanged = await saveDeckIndex(dir, buildDeckIndex(indexEntries, profile));

    info('');
    done(
      `${written} of ${targets.length} deck${targets.length === 1 ? '' : 's'} written to ${cyan(dir)}`,
    );
    info(dim(`  data files are named <deck>${DECK_DATA_SUFFIX}`));
    info(dim(`  deck index ${indexChanged ? 'updated' : 'unchanged'}`));
  },
);

program
  .command('serve')
  .description('Serve the web app against your real printed ledger, config and decklists')
  .option('--port <n>', 'port to listen on', (value) => Number.parseInt(value, 10), 5174)
  .option('--host <host>', 'interface to bind', '127.0.0.1')
  .option('--decks <dir>', 'decks directory (default: ./examples)')
  .option('--printed <path>', 'printed-ledger file')
  .option('--config <path>', 'config file')
  .option('--site <dir>', 'serve a built web app from this directory too')
  .action(async (options: {
    port: number;
    host: string;
    decks?: string;
    printed?: string;
    config?: string;
    site?: string;
  }) => {
    const running = await serve(options);
    info(`${bold('mtgproxy serve')} ${running.url}`);
    info(dim(`  decks       ${decksDir(options.decks)}`));
    info(dim(`  printed     ${printedPath(options.printed)}`));
    info(dim(`  config      ${configPath(options.config)}`));
    if (options.site) info(dim(`  site        ${resolvePath(options.site)}`));
    else info(dim('  run the web app with `pnpm --filter @mtgproxy/web dev`; it proxies /api here'));
    info('');
    info(dim('  The web app writes pinned printings straight into the decklists above.'));
    info(dim('  Ctrl-C to stop.'));
    // Nothing further to do on this tick; the server holds the process open.
    await new Promise(() => {});
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

withDeckOptions(
  program
    .command('tokens')
    .description("List the tokens a deck can make, and write them into its Tokens section")
    .argument('<file>', 'decklist file, or - to read stdin')
    .option('-q, --quantity <n>', 'how many of each to list', (v) => Number.parseInt(v, 10), 4)
    .option('-w, --write', "replace the decklist's Tokens section with the result")
    .option('--json', 'emit the tokens as JSON on stdout'),
).action(
  async (
    file: string,
    flags: DeckFlags & { quantity: number; write?: boolean; json?: boolean },
  ) => {
    const { resolve, client } = await prepare(file, { ...flags, tokens: 'exclude' });
    reportResolve(resolve);
    if (resolve.resolved.length === 0) throw new Error('nothing to inspect: no cards resolved');

    // Stored deck data is trimmed, so all_parts is not in it. Re-read the
    // chosen printings by id: one request per 75 cards, not one per card.
    const ids = [...new Set(resolve.resolved.map((item) => item.card.id))].map((id) => ({ id }));
    const full = (await client.collection(ids)).data;

    const partIds = new Set<string>();
    for (const card of full) for (const part of tokenParts(card)) partIds.add(part.id);
    if (partIds.size === 0) {
      done('no card in this deck makes a token');
      return;
    }

    const tokenCards = (await client.collection([...partIds].map((id) => ({ id })))).data;

    // One token per distinct printed face: two cards can name different
    // printings of the same token, and a 3/3 Wraith is not a 2/2 one.
    const distinct = new Map<string, (typeof tokenCards)[number]>();
    for (const token of tokenCards) {
      const identity = [
        token.name,
        token.power ?? '',
        token.toughness ?? '',
        token.oracle_text ?? '',
      ].join('|');
      if (!distinct.has(identity)) distinct.set(identity, token);
    }

    const rows = [...distinct.values()].sort((a, b) => a.name.localeCompare(b.name));

    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(
          rows.map((token) => ({
            name: token.name,
            set: token.set,
            collectorNumber: token.collector_number,
            typeLine: token.type_line,
            power: token.power,
            toughness: token.toughness,
            oracleText: token.oracle_text,
            imageStatus: token.image_status,
          })),
          null,
          2,
        )}\n`,
      );
      return;
    }

    // Printings are pinned, because token names collide: several different
    // Wraiths exist and only one of them is the 3/3 with menace.
    const lines = rows.map(
      (token) =>
        `${flags.quantity} ${token.name} (${token.set.toUpperCase()}) ${token.collector_number}`,
    );

    info('');
    info(`${bold('Tokens')}  ${rows.length} distinct`);
    for (const token of rows) {
      const pt = token.power ? ` ${token.power}/${token.toughness}` : '';
      const text = (token.oracle_text ?? '').replace(/\n/g, ', ');
      const poor = token.image_status !== 'highres_scan' ? yellow(` [${token.image_status}]`) : '';
      info(
        `  ${token.name}${pt} ${dim(`${token.set.toUpperCase()} ${token.collector_number}`)}${poor}`,
      );
      if (text) info(dim(`    ${text.slice(0, 90)}`));
    }

    if (!flags.write) {
      info('');
      info(bold('Tokens section'));
      info('');
      info('Tokens');
      for (const line of lines) info(line);
      info('');
      info(dim('  edit the quantities, or pass --write to put this in the decklist'));
      return;
    }

    if (file === '-') throw new Error('--write needs a file, not stdin');
    const original = await readFile(file, 'utf8');
    const written = setTokensSection(original, lines);
    if (written === original) {
      info(dim('  Tokens section already up to date'));
      return;
    }
    await writeFile(file, written);
    done(`wrote ${rows.length} tokens into ${cyan(file)}`);
  },
);

program.addCommand(printedCommand());
program.addCommand(workshopCommand());

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
