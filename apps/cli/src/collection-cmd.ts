import { Command } from 'commander';
import {
  addEntry,
  collectionStats,
  entryFromCard,
  findByName,
  removeEntry,
  searchCollection,
  sortEntries,
  type CollectionEntry,
  type Finish,
} from '@mtgproxy/core';
import { loadCollection, saveCollection } from '@mtgproxy/node';
import { makeClient } from './deck.js';
import { bold, cyan, dim, done, fail, info } from './ui.js';

/** `mtgproxy collection ...` */

function formatEntry(entry: CollectionEntry): string {
  const finish = entry.finish === 'nonfoil' ? '' : dim(` ${entry.finish}`);
  const printing = dim(`${entry.set.toUpperCase()} ${entry.collectorNumber}`);
  return `  ${String(entry.quantity).padStart(3)} ${entry.name.padEnd(36)} ${printing}${finish}`;
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
    .command('path')
    .description('Print the collection file path')
    .action(async function (this: Command) {
      const { path } = await loadCollection(filePath(this));
      process.stdout.write(`${path}\n`);
    });

  return collection;
}

export { fail };
