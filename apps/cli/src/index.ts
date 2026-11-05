#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  PAPER_SIZES,
  computeLayout,
  assessBracket,
  buildDeckData,
  buildDeckIndex,
  buildDeckIndexEntry,
  isBasicLand,
  mergeEntries,
  parseDecklist,
  selectForTokenMode,
  setTokensSection,
  addFoundTokens,
  findTokens,
  isTokenEntry,
  lookupTokenRows,
  tokenLine,
  type TokenRow,
  TOKEN_MODES,
  type TokenMode,
  refreshDeckData,
  resolveFromDeckData,
  totalCards,
  type DeckIndexEntry,
  manaCurve,
  normalizeName,
  scorePrinting,
  comparePrintings,
  type GuideStyle,
  type ImageQuality,
  type PaperName,
} from '@mtgtoolbox/core';
import { renderPdf } from '@mtgtoolbox/core/pdf';
import { serve } from './serve.js';
import {
  DECK_DATA_SUFFIX,
  adoptDeck,
  loadDeckData,
  saveDeckIndex,
  cacheStats,
  clearCache,
  configPath,
  deckId,
  decksDir,
  listDecks,
  loadConfig,
  saveConfig,
  saveDeckData,
} from '@mtgtoolbox/node';
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
  .name('mtgtoolbox')
  .description('Generate print-ready proxy sheets from a Magic decklist.')
  .version(VERSION);

/** Options shared by every command that resolves a decklist. */
function withDeckOptions(command: Command): Command {
  return command
    .option('--markdown', 'force markdown decklist-block extraction')
    .option('--quiet', 'suppress per-request logging')
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
  tokens?: TokenMode;
}

/** Shared setup: load the profile, then parse and resolve. */
async function prepare(file: string, flags: DeckFlags) {
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
  return { ...loaded, client, profile };
}

interface PrintFlags extends DeckFlags {
  output?: string;
  paper: PaperName;
  guides: GuideStyle;
  quality: ImageQuality;
  gap: number;
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
    .option('--both-faces', 'also print the back of each double-faced card'),
).action(async (file: string, flags: PrintFlags) => {
  const { resolve, client } = await prepare(file, flags);
  reportResolve(resolve, { bothFaces: flags.bothFaces ?? false });
  if (resolve.resolved.length === 0) throw new Error('nothing to print: no cards resolved');

  const { items, skipped } = await fetchImages(
    resolve,
    client,
    flags.quality,
    flags.bothFaces ?? false,
  );
  for (const message of skipped) fail(message);

  const layout = computeLayout({ paper: flags.paper, gapMm: flags.gap });
  const result = await renderPdf(items, {
    layout,
    guides: flags.guides,
    title: `mtgtoolbox - ${file === '-' ? 'decklist' : basename(file)}`,
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
  .description('Serve the web app against your real config and decklists')
  .option('--port <n>', 'port to listen on', (value) => Number.parseInt(value, 10), 5174)
  .option('--host <host>', 'interface to bind', '127.0.0.1')
  .option('--decks <dir>', 'decks directory (default: ./examples)')
  .option('--config <path>', 'config file')
  .option('--site <dir>', 'serve a built web app from this directory too')
  .action(async (options: {
    port: number;
    host: string;
    decks?: string;
    config?: string;
    site?: string;
  }) => {
    const running = await serve(options);
    info(`${bold('mtgtoolbox serve')} ${running.url}`);
    info(dim(`  decks       ${decksDir(options.decks)}`));
    info(dim(`  config      ${configPath(options.config)}`));
    if (options.site) info(dim(`  site        ${resolvePath(options.site)}`));
    else info(dim('  run the web app with `pnpm --filter @mtgtoolbox/web dev`; it proxies /api here'));
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
    .description("Find the tokens decks can make, and add them to each deck's Tokens section")
    .argument('[files...]', 'decklist files, or - for stdin (default: every deck)')
    .option('--decks <dir>', 'decks directory, when no files are given')
    .option('-q, --quantity <n>', 'how many of each new token to list', (v) => Number.parseInt(v, 10), 4)
    .option('-w, --write', "add new tokens to each decklist's Tokens section, keeping existing rows")
    .option('--json', 'emit the tokens as JSON on stdout'),
).action(
  async (
    files: string[],
    flags: DeckFlags & { decks?: string; quantity: number; write?: boolean; json?: boolean },
  ) => {
    const targets = files.length > 0 ? files : await listDecks(decksDir(flags.decks));
    if (targets.length === 0) {
      info(dim(`no decklists found in ${decksDir(flags.decks)}`));
      return;
    }
    if (flags.write && targets.includes('-')) throw new Error('--write needs a file, not stdin');

    const report: Record<string, unknown> = {};
    let changed = 0;

    for (const file of targets) {
      const id = file === '-' ? 'stdin' : deckId(file);
      if (targets.length > 1) info(`\n${bold(id)}`);
      const { resolve, parse, client } = await prepare(file, { ...flags, tokens: 'exclude' });
      reportResolve(resolve);
      if (resolve.resolved.length === 0) {
        warn(`${id}: nothing to inspect, no cards resolved`);
        continue;
      }

      const found = await findTokens(
        resolve.resolved.map((item) => item.card),
        client,
      );
      const rows: TokenRow[] = parse.entries
        .filter(isTokenEntry)
        .map(({ quantity, name, set, collectorNumber }) => ({ quantity, name, set, collectorNumber }));
      // Rows already in the section keep their quantity, including 0, so a
      // second run only ever adds what is new.
      const merged = addFoundTokens(rows, await lookupTokenRows(rows, client), found, flags.quantity);

      if (flags.json) {
        report[id] = found.map(({ card: token, madeBy }) => ({
          name: token.name,
          set: token.set,
          collectorNumber: token.collector_number,
          typeLine: token.type_line,
          power: token.power,
          toughness: token.toughness,
          oracleText: token.oracle_text,
          imageStatus: token.image_status,
          madeBy,
          listed: !merged.added.some((added) => added.card.id === token.id),
        }));
        continue;
      }

      if (found.length === 0) info(dim('  no card in this deck makes a token'));
      for (const { card: token, madeBy } of found) {
        const pt = token.power ? ` ${token.power}/${token.toughness}` : '';
        const isNew = merged.added.some((added) => added.card.id === token.id);
        const poor = token.image_status !== 'highres_scan' ? yellow(` [${token.image_status}]`) : '';
        info(
          `  ${isNew ? green('new') : dim('   ')} ${token.name}${pt} ${dim(`${token.set.toUpperCase()} ${token.collector_number}`)}${poor}`,
        );
        info(dim(`        from ${madeBy.join(', ')}`));
      }

      const lines = merged.rows.map(tokenLine);
      if (!flags.write) {
        if (merged.added.length > 0) {
          info('');
          info('Tokens');
          for (const line of lines) info(line);
        }
        continue;
      }

      const original = await readFile(file, 'utf8');
      const written = setTokensSection(original, lines);
      if (written === original) {
        info(dim('  Tokens section already up to date'));
        continue;
      }
      await writeFile(file, written);
      changed += 1;
      done(`added ${merged.added.length} token(s) to ${cyan(file)}`);
    }

    if (flags.json) {
      // A single deck keeps the plain array this command has always emitted.
      const body = targets.length === 1 ? Object.values(report)[0] : report;
      process.stdout.write(`${JSON.stringify(body ?? [], null, 2)}\n`);
      return;
    }
    if (!flags.write) {
      info('');
      info(dim('  pass --write to add the new tokens; quantities already in a decklist are kept'));
    } else if (changed > 0) {
      info(dim('  run `mtgtoolbox sync` so the stored card data includes the new tokens'));
    }
  },
);

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
