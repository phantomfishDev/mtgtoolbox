import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import {
  addEntry,
  collectionStats,
  entryFromCard,
  findByName,
  mergeIntoCollection,
  parseCollection,
  parseManaboxCsv,
  removeEntry,
  searchCollection,
  sortEntries,
  toManaboxCsv,
  type Collection,
  type CollectionEntry,
  type Finish,
} from '@mtgproxy/core';
import { loadCollection, saveCollection } from '@mtgproxy/node';
import { makeClient } from './deck.js';
import { bold, cyan, dim, done, fail, info, warn, yellow } from './ui.js';

/** `mtgproxy collection ...` */

function formatEntry(entry: CollectionEntry): string {
  const finish = entry.finish === 'nonfoil' ? '' : dim(` ${entry.finish}`);
  const language = entry.language ? dim(` ${entry.language}`) : '';
  const printing = dim(`${entry.set.toUpperCase()} ${entry.collectorNumber}`);
  return `  ${String(entry.quantity).padStart(3)} ${entry.name.padEnd(36)} ${printing}${finish}${language}`;
}

export function collectionCommand(): Command {
  const collection = new Command('collection')
    .alias('col')
    .description('Track the cards you own')
    .option('-c, --collection <path>', 'collection file (default: ~/.config/mtgproxy/collection.json)');

  const filePath = (command: Command): string | undefined =>
    command.parent?.opts<{ collection?: string }>().collection;

  collection
    .command('add')
    .description('Add a card to the collection')
    .argument('<name>', 'card name')
    .option('-s, --set <code>', 'set code of the printing you own')
    .option('-n, --number <cn>', 'collector number')
    .option('-q, --quantity <n>', 'how many copies', (v) => Number.parseInt(v, 10), 1)
    .option('-f, --finish <finish>', 'nonfoil, foil or etched', 'nonfoil')
    .option('-t, --tag <tag>', 'tag (repeatable)', (v: string, p: string[] = []) => [...p, v])
    .action(async function (this: Command, name: string, options) {
      const path = filePath(this);
      const client = makeClient(true);

      // Resolve through Scryfall so the stored name and printing are canonical
      // rather than however the user typed them.
      const card =
        options.set && options.number
          ? (await client.collection([{ set: options.set, collector_number: options.number }])).data[0]
          : await client.named(name);

      if (!card) throw new Error(`no Scryfall match for "${name}"`);

      const { data } = await loadCollection(path);
      const entry = entryFromCard(card, {
        quantity: options.quantity,
        finish: options.finish as Finish,
        tags: options.tag,
      });
      const saved = await saveCollection(addEntry(data, entry), path);
      done(
        `added ${options.quantity} x ${bold(card.name)} ` +
          dim(`(${card.set.toUpperCase()} ${card.collector_number}) -> ${saved}`),
      );
    });

  collection
    .command('remove')
    .alias('rm')
    .description('Remove copies from the collection')
    .argument('<name>', 'card name')
    .option('-s, --set <code>', 'only this set')
    .option('-n, --number <cn>', 'only this collector number')
    .option('-q, --quantity <n>', 'how many copies (default: all)', (v) => Number.parseInt(v, 10))
    .option('-f, --finish <finish>', 'nonfoil, foil or etched', 'nonfoil')
    .action(async function (this: Command, name: string, options) {
      const path = filePath(this);
      const { data } = await loadCollection(path);

      const matches = findByName(data, name).filter(
        (entry) =>
          (!options.set || entry.set === options.set.toLowerCase()) &&
          (!options.number || entry.collectorNumber === options.number),
      );
      if (matches.length === 0) throw new Error(`"${name}" is not in the collection`);
      if (matches.length > 1 && !options.set) {
        info(`${matches.length} printings of ${bold(name)}; narrow with --set / --number:`);
        for (const entry of sortEntries(matches)) info(formatEntry(entry));
        return;
      }

      const target = matches[0]!;
      const result = removeEntry(data, target, options.quantity ?? Number.POSITIVE_INFINITY);
      await saveCollection(result.collection, path);
      done(`removed ${result.removed} x ${bold(target.name)} ${dim(target.set.toUpperCase())}`);
    });

  collection
    .command('list')
    .alias('ls')
    .description('List the collection')
    .option('--json', 'emit JSON')
    .action(async function (this: Command, options) {
      const { data, existed, path } = await loadCollection(filePath(this));
      if (options.json) {
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
        return;
      }
      if (!existed) {
        info(dim(`no collection yet at ${path}`));
        return;
      }
      for (const entry of sortEntries(data.cards)) info(formatEntry(entry));
      const stats = collectionStats(data);
      info('');
      info(`${stats.totalCards} cards, ${stats.distinctNames} distinct names`);
    });

  collection
    .command('search')
    .description('Search the collection by name or tag')
    .argument('<query>')
    .action(async function (this: Command, query: string) {
      const { data } = await loadCollection(filePath(this));
      const hits = sortEntries(searchCollection(data, query));
      if (hits.length === 0) {
        info(dim(`nothing matching "${query}"`));
        return;
      }
      for (const entry of hits) info(formatEntry(entry));
    });

  collection
    .command('stats')
    .description('Summarise the collection')
    .action(async function (this: Command) {
      const { data, existed, path } = await loadCollection(filePath(this));
      if (!existed) {
        info(dim(`no collection yet at ${path}`));
        return;
      }
      const stats = collectionStats(data);
      info(`${bold('File')}       ${cyan(path)}`);
      info(`${bold('Cards')}      ${stats.totalCards}`);
      info(`${bold('Distinct')}   ${stats.distinctNames} names, ${stats.distinctPrintings} printings`);
      info(
        `${bold('Finishes')}   ${stats.byFinish.nonfoil} nonfoil, ${stats.byFinish.foil} foil, ${stats.byFinish.etched} etched`,
      );
      info(`${bold('Top sets')}`);
      for (const { set, count } of stats.bySet.slice(0, 10)) {
        info(`  ${set.toUpperCase().padEnd(6)} ${count}`);
      }
    });

  collection
    .command('import')
    .description('Import a ManaBox CSV export (or a collection.json)')
    .argument('<file>', 'path to the exported file')
    .option('--replace', 'replace the collection instead of adding to it')
    .option('--dry-run', 'report what would change without writing')
    .option('--no-binder-tags', 'do not tag cards with their ManaBox binder')
    .action(async function (this: Command, file: string, options) {
      const path = filePath(this);
      const source = resolvePath(file);
      const text = await readFile(source, 'utf8');
      const { data: existing } = await loadCollection(path);

      const before = collectionStats(existing).totalCards;
      const next = isJson(source, text)
        ? importJson(existing, text, options.replace === true)
        : importCsv(existing, text, options);
      const after = collectionStats(next).totalCards;

      const change = options.replace ? after : after - before;
      if (options.dryRun) {
        const verb = options.replace ? 'replaces the collection with' : 'adds';
        info(dim(`dry run: ${verb} ${change} copies, leaving ${after} in total; nothing written`));
        return;
      }

      const saved = await saveCollection(next, path);
      const verb = options.replace ? 'replaced the collection with' : 'added';
      done(`${verb} ${change} copies ${dim(`-> ${saved}`)}`);
      info(dim(`  ${after} cards now, ${collectionStats(next).distinctNames} distinct names`));
    });

  collection
    .command('export')
    .description('Export the collection as a ManaBox CSV')
    .argument('[file]', 'write here instead of standard output')
    .option('--json', 'write the native collection JSON instead')
    .action(async function (this: Command, file: string | undefined, options) {
      const { data, existed, path } = await loadCollection(filePath(this));
      if (!existed) warn(`no collection yet at ${path}; exporting an empty one`);

      const text = options.json ? `${JSON.stringify(data, null, 2)}\n` : toManaboxCsv(data);
      if (!file) {
        process.stdout.write(text);
        return;
      }
      const target = resolvePath(file);
      await writeFile(target, text, 'utf8');
      done(`wrote ${data.cards.length} entries ${dim(`-> ${cyan(target)}`)}`);
    });

  collection
    .command('path')
    .description('Print the collection file path')
    .action(async function (this: Command) {
      const { path } = await loadCollection(filePath(this));
      process.stdout.write(`${path}\n`);
    });

  return collection;
}

/**
 * Tell the two importable formats apart.
 *
 * The extension decides when it can, because a `.csv` whose first cell happens
 * to start with a brace is still a CSV; sniffing is the fallback for files
 * named something else entirely.
 */
function isJson(path: string, text: string): boolean {
  const extension = extname(path).toLowerCase();
  if (extension === '.json') return true;
  if (extension === '.csv') return false;
  return text.trimStart().startsWith('{');
}

/** Import this tool's own export, which is a whole collection rather than rows. */
function importJson(existing: Collection, text: string, replace: boolean): Collection {
  const incoming = parseCollection(JSON.parse(text));
  info(dim(`  reading a collection.json with ${incoming.cards.length} entries`));
  return replace ? incoming : mergeIntoCollection(existing, incoming.cards);
}

/**
 * Import a ManaBox CSV, reporting the rows it could not use.
 *
 * Skipped rows are warned about rather than thrown on: one unreadable line in a
 * scan of several thousand cards should not cost you the other several thousand.
 */
function importCsv(
  existing: Collection,
  text: string,
  options: { replace?: boolean; binderTags?: boolean },
): Collection {
  const result = parseManaboxCsv(text, { tagBinders: options.binderTags !== false });
  info(dim(`  read ${result.rows} rows, ${result.entries.length} usable`));

  if (result.skipped.length > 0) {
    warn(`skipped ${result.skipped.length} rows:`);
    for (const row of result.skipped.slice(0, 10)) {
      info(`  ${yellow(`line ${row.line}`)} ${row.name ?? dim('(unnamed)')}: ${row.reason}`);
    }
    if (result.skipped.length > 10) info(dim(`  ...and ${result.skipped.length - 10} more`));
  }

  return mergeIntoCollection(existing, result.entries, {
    mode: options.replace ? 'replace' : 'merge',
  });
}

export { fail };
