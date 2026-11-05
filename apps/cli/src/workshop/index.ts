import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import {
  applyProposal,
  assessBracket,
  isUniversesBeyond,
  keptCards,
  manaCurve,
  normalizeName,
  parseWorkshopProposal,
  phaseOwner,
  proposalSize,
  proposalToDecklist,
  replaceProposal,
  WORKSHOP_PHASES,
  type DeckEntry,
  type ResolvedCard,
  type ScryfallCard,
  type ScryfallClient,
  type WorkshopPhase,
  type WorkshopProposal,
  type WorkshopSession,
} from '@mtgtoolbox/core';
import {
  decksDir,
  loadWorkshopSession,
  listWorkshopSessions,
  openWorkshopSession,
  proposalPath,
  saveWorkshopSession,
  sessionPath,
  workshopSlug,
} from '@mtgtoolbox/node';
import { makeClient } from '../deck.js';
import { bold, cyan, dim, done, fail, green, info, warn, yellow } from '../ui.js';
import { cardForUi, serveWorkshop } from './server.js';

/**
 * `mtgtoolbox workshop ...` — the two-sided deck-building loop.
 *
 * A deck gets built by a person and an agent taking turns over one session
 * file: the person describes the deck and picks the cards they already know
 * they want, the agent fills in the rest, the person cuts and comments, repeat.
 * These commands are the agent's side of that. The person's side is the page
 * `workshop start` serves.
 *
 * Nothing here takes a fixed port. Several of these run at once on one machine
 * — one per deck, one per agent session — so the default is to ask the OS for a
 * free port and print the URL.
 */

const EXAMPLE_PROPOSAL = {
  summary:
    'One or two paragraphs: what the deck does, what changed since the last round, and what you deliberately left out.',
  questions: [
    {
      id: 'wincon',
      text: 'Do you want the combo finish, or should it win by attacking?',
      options: ['combo', 'attacking', 'both'],
    },
  ],
  cards: [
    { name: 'Thranduil, Elvenking', role: 'Commander', note: 'the deck' },
    { name: 'Sol Ring', role: 'Ramp', note: 'it is Sol Ring' },
    { name: 'Lembas', role: 'Ramp', note: 'on-theme rock that draws later' },
    { quantity: 9, name: 'Forest', role: 'Lands', note: '' },
  ],
};

/** A proposal card as a decklist entry, so core's analysis can read it. */
function entryFor(name: string, quantity: number, index: number): DeckEntry {
  return { quantity, name, line: index + 1, raw: `${quantity} ${name}` };
}

function summarize(session: WorkshopSession): void {
  const owner = phaseOwner(session.phase);
  info(`${bold(session.title || session.slug)} ${dim(session.slug)}`);
  info(
    `  phase       ${cyan(session.phase)} ${dim(`(${owner === 'agent' ? 'your turn' : 'waiting on the person'})`)}`,
  );
  info(`  round       ${session.round}`);
  info(`  updated     ${session.updatedAt} ${dim(`by ${session.updatedBy}`)}`);

  const brief = session.brief;
  if (brief.commander) info(`  commander   ${brief.commander.name}`);
  info(`  bracket     ceiling ${brief.bracket}`);
  if (brief.theme.trim()) info(`  theme       ${brief.theme.trim().split('\n').join(' / ')}`);
  if (brief.artDirection.trim()) info(`  art         ${brief.artDirection.trim()}`);
  if (brief.notes.trim()) info(`  notes       ${brief.notes.trim().split('\n').join(' / ')}`);
  if (brief.include.length > 0) {
    info(`  must include`);
    for (const pick of brief.include) {
      info(`    + ${pick.name}${pick.note ? dim(` — ${pick.note}`) : ''}`);
    }
  }
  if (brief.avoid.length > 0) {
    info(`  keep out`);
    for (const pick of brief.avoid) {
      info(`    - ${pick.name}${pick.note ? dim(` — ${pick.note}`) : ''}`);
    }
  }

  if (session.proposal) {
    info(`  proposal    round ${session.proposal.round}, ${proposalSize(session.proposal)} cards`);
  }
  const review = session.review;
  if (review) {
    info(`  review      verdict ${review.verdict}, ${review.cuts.length} cut`);
    for (const cut of review.cuts) {
      const comment = review.comments[cut];
      info(`    ${yellow('cut')} ${cut}${comment ? dim(` — ${comment}`) : ''}`);
    }
    for (const [name, comment] of Object.entries(review.comments)) {
      if (review.cuts.some((cut) => normalizeName(cut) === normalizeName(name))) continue;
      info(`    ${dim('keep')} ${name} ${dim(`— ${comment}`)}`);
    }
    if (review.notes.trim()) info(`    notes ${review.notes.trim().split('\n').join(' / ')}`);
    for (const [id, answer] of Object.entries(review.answers)) {
      info(`    answer ${id}: ${answer}`);
    }
  }
}

async function mustLoad(slug: string, dir?: string): Promise<WorkshopSession> {
  const session = await loadWorkshopSession(slug, dir);
  if (!session) {
    throw new Error(
      `no workshop session named "${slug}" (looked in ${sessionPath(slug, dir)}); start one with \`mtgtoolbox workshop start ${slug}\``,
    );
  }
  return session;
}

/**
 * Whether a printing is one this household would never print.
 *
 * Scryfall's default printing for a name is whatever it considers the most
 * representative, and that is increasingly a crossover or a boxed-product
 * reprint: asking for "Sol Ring" by name currently hands back the Star Trek
 * one. The review screen draws the deck from these, so a reviewer ends up
 * judging a colorless Eldrazi deck through Marvel and Star Trek frames.
 */
function isNoveltyPrinting(card: ScryfallCard): boolean {
  return (
    isUniversesBeyond(card) ||
    card.textless === true ||
    card.promo === true ||
    // Secret Lair products are set type `box`; `funny` is Un-sets.
    ['box', 'funny', 'memorabilia', 'token'].includes(card.set_type) ||
    card.image_status !== 'highres_scan'
  );
}

/**
 * A printing worth showing in the review screen.
 *
 * Only called for the cards whose default printing is unusable, so this costs
 * a request each for a handful of cards rather than one per card in the deck.
 * The original printing of a card is never a crossover and is almost always
 * the painted art, which is what these decks are for. The swap is cosmetic:
 * the proposal still records no printing, so the preference profile picks the
 * real one at sync time.
 */
async function indicativePrinting(
  client: ScryfallClient,
  card: ScryfallCard,
): Promise<ScryfallCard | null> {
  const query = `!"${card.name.replace(/"/g, '')}" prefer:oldest -is:token game:paper`;
  try {
    const [found] = await client.search(query, { limit: 1 });
    // Do not trade a crossover for a scan nobody can read.
    if (!found || found.image_status !== 'highres_scan') return null;
    return isNoveltyPrinting(found) ? null : found;
  } catch {
    // The art is a nicety; a failed lookup must not fail the proposal.
    return null;
  }
}

export function workshopCommand(): Command {
  const workshop = new Command('workshop')
    .description('Build a deck with someone: a brief, a proposal, and a round of cuts')
    .option('--dir <path>', 'workshop directory (default: ./.workshop)');

  const dirOf = (command: Command): string | undefined =>
    command.parent?.opts<{ dir?: string }>().dir;

  workshop
    .command('start')
    .description('Open the workshop UI for a deck and wait on the person')
    .argument('[name]', 'deck name or slug; a new session is created if there is none', 'new-deck')
    .option('--port <n>', 'port to listen on; 0 asks the OS for a free one', (value) => Number.parseInt(value, 10), 0)
    .option('--host <host>', 'interface to bind', '127.0.0.1')
    .option('--title <text>', 'deck title shown in the UI')
    .action(async function (this: Command, name: string, flags: { port: number; host: string; title?: string }) {
      const dir = dirOf(this);
      const slug = workshopSlug(name);
      const { session, created } = await openWorkshopSession(slug, flags.title ?? name, dir);
      const running = await serveWorkshop({
        slug,
        port: flags.port,
        host: flags.host,
        client: makeClient(true),
        ...(dir ? { dir } : {}),
      });

      info(`${bold('mtgtoolbox workshop')} ${cyan(running.url)}`);
      info(dim(`  deck     ${session.title || slug} (${slug})`));
      info(dim(`  session  ${sessionPath(slug, dir)}`));
      info(dim(`  phase    ${session.phase}${created ? ' (new session)' : ''}`));
      info('');
      info(dim('  Open the URL, fill in the brief, and send it over. Then:'));
      info(dim(`    mtgtoolbox workshop wait ${slug}        # blocks until it is your turn`));
      info(dim(`    mtgtoolbox workshop show ${slug}        # read the brief or the review`));
      info(dim(`    mtgtoolbox workshop propose ${slug}     # put a decklist on the table`));
      info(dim('  Ctrl-C to stop.'));
      // The server holds the process open.
      await new Promise(() => {});
    });

  workshop
    .command('wait')
    .description('Block until the session reaches a phase that needs you, then print it')
    .argument('<slug>')
    .option(
      '--for <phases>',
      'comma-separated phases to wait for',
      'briefed,reviewed,accepted',
    )
    .option('--timeout <seconds>', 'give up after this long', (value) => Number.parseInt(value, 10), 3600)
    .option('--interval <ms>', 'how often to look', (value) => Number.parseInt(value, 10), 1500)
    .action(async function (
      this: Command,
      slug: string,
      flags: { for: string; timeout: number; interval: number },
    ) {
      const dir = dirOf(this);
      const wanted = flags.for
        .split(',')
        .map((phase) => phase.trim())
        .filter((phase) => phase !== '');
      for (const phase of wanted) {
        if (!(WORKSHOP_PHASES as readonly string[]).includes(phase)) {
          throw new Error(`unknown phase "${phase}"; expected one of ${WORKSHOP_PHASES.join(', ')}`);
        }
      }

      await mustLoad(slug, dir);
      const deadline = Date.now() + flags.timeout * 1000;

      for (;;) {
        const session = await loadWorkshopSession(slug, dir);
        if (session && (wanted as WorkshopPhase[]).includes(session.phase)) {
          // One line on stdout, so whatever is watching this process learns
          // what happened without reading the file itself.
          const review = session.review;
          const detail =
            session.phase === 'reviewed' || session.phase === 'accepted'
              ? ` cuts=${review?.cuts.length ?? 0} comments=${Object.keys(review?.comments ?? {}).length}`
              : '';
          process.stdout.write(`${session.phase} round=${session.round}${detail}\n`);
          done(`${slug} is ${session.phase}; run \`mtgtoolbox workshop show ${slug}\``);
          return;
        }
        if (Date.now() >= deadline) {
          process.stdout.write(`timeout phase=${session?.phase ?? 'missing'}\n`);
          fail(`timed out after ${flags.timeout}s waiting for ${flags.for}`);
          process.exitCode = 1;
          return;
        }
        await new Promise((tick) => setTimeout(tick, flags.interval));
      }
    });

  workshop
    .command('show')
    .description('Print the brief, the proposal and the review')
    .argument('<slug>')
    .option('--json', 'emit the whole session as JSON on stdout')
    .action(async function (this: Command, slug: string, flags: { json?: boolean }) {
      const session = await mustLoad(slug, dirOf(this));
      if (flags.json) {
        process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
        return;
      }
      summarize(session);
    });

  workshop
    .command('list')
    .description('Every session in the workshop directory, newest first')
    .action(async function (this: Command) {
      const sessions = await listWorkshopSessions(dirOf(this));
      if (sessions.length === 0) {
        info(dim('no sessions yet'));
        return;
      }
      for (const session of sessions) {
        const turn = phaseOwner(session.phase) === 'agent' ? green('your turn') : dim('their turn');
        info(
          `  ${session.slug.padEnd(24)} ${session.phase.padEnd(9)} round ${session.round}  ${turn}`,
        );
      }
    });

  workshop
    .command('propose')
    .description('Put a decklist on the table for the person to cut')
    .argument('[slug]')
    .option('-f, --file <path>', 'proposal JSON (default: the session directory\'s proposal.json)')
    .option('--summary <text>', 'override the summary in the file')
    .option(
      '--replace',
      'correct the round already on the table instead of starting a new one; keeps their review',
    )
    .option('--example', 'print an example proposal file and exit')
    .action(async function (
      this: Command,
      slug: string | undefined,
      flags: { file?: string; summary?: string; replace?: boolean; example?: boolean },
    ) {
      if (flags.example) {
        process.stdout.write(`${JSON.stringify(EXAMPLE_PROPOSAL, null, 2)}\n`);
        return;
      }
      if (!slug) throw new Error('a session slug is required');
      const dir = dirOf(this);
      const session = await mustLoad(slug, dir);
      const path = flags.file ?? proposalPath(slug, dir);

      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            `no proposal at ${path}; write one there (see \`mtgtoolbox workshop propose --example\`)`,
          );
        }
        throw error;
      }

      const proposal = parseWorkshopProposal(raw);
      if (proposal.cards.length === 0) throw new Error('the proposal has no cards');
      if (flags.summary) proposal.summary = flags.summary;

      // Look the cards up in one batch so the review screen has real art, real
      // costs and a real bracket read rather than the agent's word for them.
      const client = makeClient(true);
      const identifiers = proposal.cards.map((card) =>
        card.set && card.collectorNumber
          ? { set: card.set, collector_number: card.collectorNumber }
          : { name: card.name },
      );
      const found = await client.collection(identifiers);
      const byName = new Map<string, ScryfallCard>();
      for (const card of found.data) byName.set(normalizeName(card.name), card);

      // Replace unusable default art before anything is drawn from it.
      let reArted = 0;
      for (const [key, match] of byName) {
        if (!isNoveltyPrinting(match)) continue;
        const better = await indicativePrinting(client, match);
        if (!better) continue;
        // Keep the card the deck resolved to; borrow only its picture.
        byName.set(key, { ...match, image_uris: better.image_uris, card_faces: better.card_faces });
        reArted += 1;
      }

      const resolved: ResolvedCard[] = [];
      const unresolved: string[] = [];
      const enriched = proposal.cards.map((card, index) => {
        const match = byName.get(normalizeName(card.name));
        if (!match) {
          unresolved.push(card.name);
          return card;
        }
        resolved.push({
          entry: entryFor(match.name, card.quantity, index),
          card: match,
          via: 'name',
        });
        const ui = cardForUi(match) as Record<string, unknown>;
        const pinned = Boolean(card.set && card.collectorNumber);
        return {
          ...card,
          // The agent's name may be a near miss; Scryfall's is canonical.
          name: match.name,
          // The printing is deliberately NOT taken from this lookup. Asking
          // Scryfall for a name returns whichever printing it considers
          // default, which is frequently a Secret Lair — writing that into the
          // proposal would pin it into the exported decklist behind the
          // preference profile's back. An unpinned card stays unpinned, and
          // `mtgtoolbox sync` picks the art. The image below is indicative only.
          ...(pinned ? { scryfallId: match.id } : {}),
          manaCost: ui['manaCost'] as string,
          typeLine: ui['typeLine'] as string,
          cmc: ui['cmc'] as number,
          colorIdentity: ui['colorIdentity'] as string[],
          oracleText: ui['oracleText'] as string,
          ...(ui['image'] ? { image: ui['image'] as string } : {}),
          gameChanger: ui['gameChanger'] as boolean,
        };
      });

      const curve = manaCurve(resolved);
      const assessment = assessBracket(resolved);
      const gameChangers =
        assessment.signals.find((signal) => signal.code === 'game-changers')?.cards ?? [];

      const complete: WorkshopProposal = {
        ...proposal,
        cards: enriched,
        stats: {
          cards: enriched.reduce((sum, card) => sum + card.quantity, 0),
          lands: curve.lands,
          averageManaValue: curve.averageManaValue,
          bracket: assessment.bracket,
          bracketName: assessment.name,
          gameChangers,
          unresolved,
        },
      };

      const next = flags.replace
        ? replaceProposal(session, complete)
        : applyProposal(session, complete);
      await saveWorkshopSession(next, dir);

      for (const name of unresolved) fail(`no Scryfall match for "${name}"`);
      const total = proposalSize(complete);
      if (total !== 100) warn(`${total} cards; a Commander deck is 100`);
      if (assessment.bracket > session.brief.bracket) {
        warn(
          `assessed bracket ${assessment.bracket} is above the ceiling of ${session.brief.bracket} in the brief`,
        );
      }
      for (const name of gameChangers) warn(`game changer: ${name}`);

      done(
        flags.replace
          ? `round ${next.round} corrected for ${cyan(slug)}`
          : `round ${next.round} is on the table for ${cyan(slug)}`,
      );
      info(dim(`  ${total} cards, ${curve.lands} lands, avg MV ${curve.averageManaValue.toFixed(2)}`));
      if (reArted > 0) {
        info(dim(`  ${reArted} card(s) shown with their original art instead of a crossover or promo`));
      }
      info(dim(`  bracket ${assessment.bracket} - ${assessment.name}`));
      info(
        dim(
          flags.replace
            ? '  the page the person has open will pick the correction up on its own'
            : '  the page the person has open will switch to the review screen on its own',
        ),
      );
      info(dim(`  then: mtgtoolbox workshop wait ${slug}`));
    });

  workshop
    .command('export')
    .description('Write the accepted list to a decklist file')
    .argument('<slug>')
    .option('--decks <dir>', 'decks directory (default: ./examples)')
    .option('-o, --output <path>', 'write here instead')
    .option('--force', 'export a list that has not been accepted yet')
    .action(async function (
      this: Command,
      slug: string,
      flags: { decks?: string; output?: string; force?: boolean },
    ) {
      const dir = dirOf(this);
      const session = await mustLoad(slug, dir);
      if (!session.proposal) throw new Error('nothing to export: no proposal yet');
      if (session.phase !== 'accepted' && !flags.force) {
        throw new Error(
          `${slug} is ${session.phase}, not accepted; pass --force to export it anyway`,
        );
      }

      const kept = keptCards(session);
      const text = proposalToDecklist(session);
      const target = resolvePath(flags.output ?? join(decksDir(flags.decks), `${slug}.txt`));
      await writeFile(target, text, 'utf8');

      done(`wrote ${cyan(target)}`);
      info(
        dim(
          `  ${kept.reduce((sum, card) => sum + card.quantity, 0)} cards` +
            (session.review?.cuts.length ? `, ${session.review.cuts.length} cut in review` : ''),
        ),
      );
      info(dim(`  next: mtgtoolbox sync ${target}  then bare \`mtgtoolbox sync\` to refresh the index`));
    });

  return workshop;
}
