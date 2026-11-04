import { z } from 'zod';
import { normalizeName } from '../printed/types.js';

/**
 * A deck-building session shared between a person and an agent.
 *
 * Building a deck is a conversation that needs pictures: the person knows which
 * cards they want and what the deck should feel like, the agent knows the other
 * ninety, and neither can judge a cut from a name alone. So the two halves meet
 * in one file. The person fills it in through the workshop UI, an agent reads
 * it, writes a proposal back, and the UI flips to a review screen where cards
 * get cut and commented on. The phase is the handshake:
 *
 *   intake   -> the person is filling in the brief; the agent waits
 *   briefed  -> the brief is submitted; the agent's turn
 *   proposed -> a decklist is on the table; the person's turn
 *   reviewed -> cuts and comments are in; the agent's turn again
 *   accepted -> the person is happy; the list can be exported
 *
 * Everything is optional-with-a-default rather than required, because a session
 * written by hand (or by an older version) must still load.
 */

export const WORKSHOP_VERSION = 1;

export const WORKSHOP_PHASES = [
  'intake',
  'briefed',
  'proposed',
  'reviewed',
  'accepted',
] as const;

export type WorkshopPhase = (typeof WORKSHOP_PHASES)[number];

/** Whose turn a phase represents. */
export function phaseOwner(phase: WorkshopPhase): 'user' | 'agent' {
  return phase === 'intake' || phase === 'proposed' ? 'user' : 'agent';
}

/**
 * A card as the UI found it on Scryfall.
 *
 * Enough of the card travels with the pick that an agent reading the file knows
 * what it is looking at — cost, type, colour identity — without a round trip of
 * its own, and the UI can draw the card again from the file alone.
 */
const WorkshopCardSchema = z.object({
  name: z.string(),
  set: z.string().optional(),
  collectorNumber: z.string().optional(),
  scryfallId: z.string().optional(),
  manaCost: z.string().optional(),
  typeLine: z.string().optional(),
  cmc: z.number().optional(),
  colorIdentity: z.array(z.string()).optional(),
  oracleText: z.string().optional(),
  /** Front-face image, small size: this is a picker, not a print sheet. */
  image: z.string().optional(),
  gameChanger: z.boolean().optional(),
});

/** A card the person asked for, with the reason they gave. */
const WorkshopPickSchema = WorkshopCardSchema.extend({
  note: z.string().default(''),
});

const BriefSchema = z.object({
  commander: WorkshopCardSchema.nullish().default(null),
  /** A second commander, for partner and background pairings. */
  partner: WorkshopCardSchema.nullish().default(null),
  /** The ceiling, not the target: 1-5 on the Commander bracket scale. */
  bracket: z.number().int().min(1).max(5).default(3),
  /** What the deck is about — the flavour, the lines the person wants to draw. */
  theme: z.string().default(''),
  /** How the printings should look, since these decks get printed. */
  artDirection: z.string().default(''),
  /** Anything else: budget, pet cards, a table to beat, cards to leave out. */
  notes: z.string().default(''),
  include: z.array(WorkshopPickSchema).default([]),
  avoid: z.array(WorkshopPickSchema).default([]),
});

const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Suggested answers, offered as buttons. Free text is always allowed. */
  options: z.array(z.string()).default([]),
});

/** One line of a proposed decklist. */
const ProposalCardSchema = WorkshopCardSchema.extend({
  quantity: z.number().int().min(1).default(1),
  /** The job the card does, used to group the review screen. */
  role: z.string().default('Deck'),
  /** Why it is in the deck. The person is cutting cards off these. */
  note: z.string().default(''),
});

const ProposalSchema = z.object({
  round: z.number().int().min(1).default(1),
  /** The agent's pitch for this version of the deck. */
  summary: z.string().default(''),
  cards: z.array(ProposalCardSchema).default([]),
  questions: z.array(QuestionSchema).default([]),
  /** Filled in by `workshop propose` once the cards are resolved. */
  stats: z
    .object({
      cards: z.number(),
      lands: z.number(),
      averageManaValue: z.number(),
      bracket: z.number(),
      bracketName: z.string(),
      gameChangers: z.array(z.string()).default([]),
      unresolved: z.array(z.string()).default([]),
    })
    .nullish()
    .default(null),
});

const ReviewSchema = z.object({
  round: z.number().int().min(1).default(1),
  /** Card names the person wants gone. */
  cuts: z.array(z.string()).default([]),
  /** Card name -> what they said about it. Keeps and cuts both. */
  comments: z.record(z.string(), z.string()).default({}),
  /** Overall direction for the next round. */
  notes: z.string().default(''),
  /** Question id -> answer. */
  answers: z.record(z.string(), z.string()).default({}),
  verdict: z.enum(['revise', 'accept']).default('revise'),
});

export const WorkshopSessionSchema = z.object({
  version: z.number().default(WORKSHOP_VERSION),
  /** Deck id: becomes `examples/<slug>.txt` when the deck is exported. */
  slug: z.string(),
  title: z.string().default(''),
  phase: z.enum(WORKSHOP_PHASES).default('intake'),
  /** Proposal rounds so far. 0 until the agent proposes anything. */
  round: z.number().int().min(0).default(0),
  updatedAt: z.string().default(() => new Date().toISOString()),
  updatedBy: z.enum(['user', 'agent']).default('user'),
  // The default is produced by the schema itself: zod wants the parsed shape
  // here, and writing one out by hand would be a second place to update.
  brief: BriefSchema.default(() => BriefSchema.parse({})),
  proposal: ProposalSchema.nullish().default(null),
  review: ReviewSchema.nullish().default(null),
  /** Every round that has been through the loop, oldest first. */
  history: z
    .array(
      z.object({
        round: z.number(),
        at: z.string(),
        phase: z.enum(WORKSHOP_PHASES),
        summary: z.string().default(''),
        cuts: z.array(z.string()).default([]),
        notes: z.string().default(''),
      }),
    )
    .default([]),
});

export type WorkshopCard = z.infer<typeof WorkshopCardSchema>;
export type WorkshopPick = z.infer<typeof WorkshopPickSchema>;
export type WorkshopBrief = z.infer<typeof BriefSchema>;
export type WorkshopQuestion = z.infer<typeof QuestionSchema>;
export type WorkshopProposalCard = z.infer<typeof ProposalCardSchema>;
export type WorkshopProposal = z.infer<typeof ProposalSchema>;
export type WorkshopReview = z.infer<typeof ReviewSchema>;
export type WorkshopSession = z.infer<typeof WorkshopSessionSchema>;

export function parseWorkshopSession(data: unknown): WorkshopSession {
  return WorkshopSessionSchema.parse(data);
}

/** A proposal written by hand or by an agent, filled out with defaults. */
export function parseWorkshopProposal(data: unknown): WorkshopProposal {
  return ProposalSchema.parse(data);
}

export function newWorkshopSession(slug: string, title?: string): WorkshopSession {
  return parseWorkshopSession({ slug, title: title ?? slug });
}

const stamp = (session: WorkshopSession, by: 'user' | 'agent'): WorkshopSession => ({
  ...session,
  updatedAt: new Date().toISOString(),
  updatedBy: by,
});

/** Save the brief without handing the turn over, for the UI's autosave. */
export function saveBrief(session: WorkshopSession, brief: WorkshopBrief): WorkshopSession {
  return stamp({ ...session, brief }, 'user');
}

/** The person is done describing the deck: the agent's turn. */
export function submitBrief(session: WorkshopSession, brief: WorkshopBrief): WorkshopSession {
  return stamp({ ...session, brief, phase: 'briefed' }, 'user');
}

/**
 * Put a decklist on the table.
 *
 * The round number comes from the session rather than the proposal, so an agent
 * that forgets to increment it cannot make two rounds look like one.
 */
export function applyProposal(
  session: WorkshopSession,
  proposal: WorkshopProposal,
): WorkshopSession {
  const round = session.round + 1;
  return stamp(
    {
      ...session,
      round,
      phase: 'proposed',
      proposal: { ...proposal, round },
      // The previous round's cuts have been acted on; keep them in history only.
      review: null,
      history: session.review
        ? [
            ...session.history,
            {
              round: session.review.round,
              at: session.updatedAt,
              phase: 'reviewed' as const,
              summary: session.proposal?.summary ?? '',
              cuts: session.review.cuts,
              notes: session.review.notes,
            },
          ]
        : session.history,
    },
    'agent',
  );
}

/**
 * Correct the round on the table without starting a new one.
 *
 * A proposal with a wrong card note or a miscounted line is a mistake, not a
 * revision: bumping the round for it would tell the person their cuts had been
 * acted on when nothing was, and `applyProposal` would clear the review they
 * are part-way through writing. This leaves the round, the phase and the
 * review exactly where they are and swaps the cards underneath.
 */
export function replaceProposal(
  session: WorkshopSession,
  proposal: WorkshopProposal,
): WorkshopSession {
  if (!session.proposal) throw new Error('there is no proposal to replace');
  return stamp(
    { ...session, proposal: { ...proposal, round: session.round } },
    'agent',
  );
}

/** Save review edits in place, for the UI's autosave. */
export function saveReview(session: WorkshopSession, review: WorkshopReview): WorkshopSession {
  return stamp({ ...session, review: { ...review, round: session.round } }, 'user');
}

/** Hand the cuts and comments back, or accept the deck as it stands. */
export function submitReview(session: WorkshopSession, review: WorkshopReview): WorkshopSession {
  const settled = { ...review, round: session.round };
  return stamp(
    {
      ...session,
      review: settled,
      phase: settled.verdict === 'accept' ? 'accepted' : 'reviewed',
    },
    'user',
  );
}

/** Add a card to the brief's include or avoid list, ignoring a duplicate. */
export function addPick(
  brief: WorkshopBrief,
  list: 'include' | 'avoid',
  pick: WorkshopPick,
): WorkshopBrief {
  const key = normalizeName(pick.name);
  const existing = brief[list];
  if (existing.some((card) => normalizeName(card.name) === key)) return brief;
  // A card cannot be wanted and unwanted at once; the newer intent wins.
  const other = list === 'include' ? 'avoid' : 'include';
  return {
    ...brief,
    [list]: [...existing, pick],
    [other]: brief[other].filter((card) => normalizeName(card.name) !== key),
  };
}

/** True when a review asked for this card to go. */
export function isCut(review: WorkshopReview | null | undefined, name: string): boolean {
  if (!review) return false;
  const key = normalizeName(name);
  return review.cuts.some((cut) => normalizeName(cut) === key);
}

/** What survives a review: the proposal minus its cuts. */
export function keptCards(session: WorkshopSession): WorkshopProposalCard[] {
  const cards = session.proposal?.cards ?? [];
  return cards.filter((card) => !isCut(session.review, card.name));
}

/** Total cards in a proposal, counting copies. */
export function proposalSize(proposal: WorkshopProposal | null | undefined): number {
  return (proposal?.cards ?? []).reduce((sum, card) => sum + card.quantity, 0);
}

/**
 * The proposal as a decklist the rest of the tool understands.
 *
 * Commanders go under their own header, every other role under `Deck`, and the
 * printing suffix is written only when the proposal pinned one — an unpinned
 * name lets the preference profile pick the art at sync time, which is where
 * that decision belongs.
 */
export function proposalToDecklist(session: WorkshopSession): string {
  const cards = keptCards(session);
  const isCommander = (card: WorkshopProposalCard) => /commander/i.test(card.role);
  const line = (card: WorkshopProposalCard) => {
    const printing = card.set && card.collectorNumber
      ? ` (${card.set.toUpperCase()}) ${card.collectorNumber}`
      : '';
    return `${card.quantity} ${card.name}${printing}`;
  };

  const header: string[] = [`# ${session.title || session.slug}`];
  const summary = session.proposal?.summary.trim();
  if (summary) {
    header.push('#');
    for (const paragraph of summary.split('\n')) header.push(`# ${paragraph}`.trimEnd());
  }
  const brief = session.brief;
  header.push('#');
  header.push(`# Bracket ceiling ${brief.bracket}.`);
  if (brief.theme.trim()) header.push(`# Theme: ${brief.theme.trim().split('\n').join(' ')}`);
  if (brief.artDirection.trim()) header.push(`# Art: ${brief.artDirection.trim()}`);

  const commanders = cards.filter(isCommander);
  const rest = cards.filter((card) => !isCommander(card));

  const body: string[] = [];
  if (commanders.length > 0) {
    body.push('Commander');
    for (const card of commanders) body.push(line(card));
    body.push('');
  }
  body.push('Deck');
  for (const card of rest) body.push(line(card));

  return `${[...header, '', ...body].join('\n')}\n`;
}
