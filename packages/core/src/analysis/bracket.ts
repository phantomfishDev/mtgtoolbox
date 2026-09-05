import type { ResolvedCard } from '../scryfall/resolve.js';
import type { ScryfallCard } from '../scryfall/types.js';
import { allOracleText } from './mana.js';

/**
 * Commander bracket assessment.
 *
 * Reports the lowest bracket a deck's *contents* are compatible with, and says
 * why. The number matters less than the reasons: a bracket is something you
 * tell a table before a game, so an unexplained figure is not much use, and a
 * confidently wrong one is worse than none.
 *
 * Criteria verified against the current rules rather than recalled: Game
 * Changers are capped at none for brackets 1-2 and three for bracket 3; mass
 * land denial and chained extra turns are bracket 4 patterns. Tutors stopped
 * being a bracket criterion in the October 2025 update and are deliberately not
 * counted here.
 */

export type Bracket = 1 | 2 | 3 | 4 | 5;

export const BRACKET_NAMES: Record<Bracket, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

export type SignalCode = 'game-changers' | 'mass-land-denial' | 'extra-turns';

export interface BracketSignal {
  code: SignalCode;
  /** The cards that triggered it, named so the reader can check the call. */
  cards: string[];
  /** The lowest bracket this signal is compatible with. */
  impliesBracket: Bracket;
  explanation: string;
}

export interface BracketAssessment {
  bracket: Bracket;
  name: string;
  signals: BracketSignal[];
  /** Criteria this tool cannot judge, stated so the number is not oversold. */
  unchecked: string[];
  summary: string;
}

/** Cards that a bracket cares about; counted once however many copies are run. */
function distinctCards(resolved: readonly ResolvedCard[]): ScryfallCard[] {
  const seen = new Map<string, ScryfallCard>();
  for (const item of resolved) seen.set(item.card.name, item.card);
  return [...seen.values()];
}

export function isGameChanger(card: ScryfallCard): boolean {
  return card.game_changer === true;
}

/**
 * Mass land denial, judged from oracle text.
 *
 * Deliberately narrow. Wrongly calling a deck bracket 4 over a misread card is
 * worse than missing one, so this matches only unambiguous wordings and leaves
 * the softer lock pieces to the unchecked list.
 */
export function isMassLandDenial(card: ScryfallCard): boolean {
  const text = allOracleText(card);
  return (
    /destroy all lands/i.test(text) ||
    /each player sacrifices? (a|an|one|two|three|\d+|all) lands?/i.test(text) ||
    /lands don't untap/i.test(text) ||
    /players can't play lands/i.test(text)
  );
}

export function isExtraTurn(card: ScryfallCard): boolean {
  const text = allOracleText(card);
  // "takes an extra turn after this one" is the standard template; exclude the
  // common "target player takes an extra turn" downside riders by not matching
  // text that only grants a turn to an opponent.
  return /takes? an extra turn after this one/i.test(text);
}

/** Extra-turn cards at or above this count read as a chain, not a one-off. */
export const EXTRA_TURN_CHAIN_THRESHOLD = 3;

export function assessBracket(resolved: readonly ResolvedCard[]): BracketAssessment {
  const cards = distinctCards(resolved);
  const signals: BracketSignal[] = [];

  const gameChangers = cards.filter(isGameChanger).map((card) => card.name).sort();
  if (gameChangers.length > 0) {
    const implied: Bracket = gameChangers.length > 3 ? 4 : 3;
    signals.push({
      code: 'game-changers',
      cards: gameChangers,
      impliesBracket: implied,
      explanation:
        gameChangers.length > 3
          ? `${gameChangers.length} Game Changers. Bracket 3 allows at most three, so this sits at 4.`
          : `${gameChangers.length} Game Changer${gameChangers.length === 1 ? '' : 's'}. Brackets 1 and 2 allow none, so this is at least a 3.`,
    });
  }

  const landDenial = cards.filter(isMassLandDenial).map((card) => card.name).sort();
  if (landDenial.length > 0) {
    signals.push({
      code: 'mass-land-denial',
      cards: landDenial,
      impliesBracket: 4,
      explanation: 'Mass land denial is a bracket 4 pattern; it is not expected below that.',
    });
  }

  const extraTurns = cards.filter(isExtraTurn).map((card) => card.name).sort();
  if (extraTurns.length > 0) {
    const chaining = extraTurns.length >= EXTRA_TURN_CHAIN_THRESHOLD;
    signals.push({
      code: 'extra-turns',
      cards: extraTurns,
      impliesBracket: chaining ? 4 : 2,
      explanation: chaining
        ? `${extraTurns.length} extra-turn cards reads as chaining them, which is a bracket 4 pattern.`
        : `${extraTurns.length} extra-turn card${extraTurns.length === 1 ? '' : 's'}. A few are fine at bracket 2 and up, but bracket 1 expects none.`,
    });
  }

  // A deck with nothing remarkable is a 2: that is what most decks and nearly
  // every precon are. Bracket 1 is a statement of intent rather than a property
  // of the cards, so it is never assigned automatically.
  const bracket = signals.reduce<Bracket>(
    (highest, signal) => (signal.impliesBracket > highest ? signal.impliesBracket : highest),
    2,
  );

  const unchecked = [
    'Two-card infinite combos — these need a combo database, and bracket 3 turns on whether a combo can happen early.',
    'Bracket 1 (Exhibition) is about how a deck is meant to be played, not what is in it, so it is never assigned automatically.',
    'Bracket 5 (cEDH) is an agreement between players about how a game will be played, not something a decklist alone decides.',
  ];

  const summary =
    signals.length === 0
      ? 'Nothing here pushes the deck above bracket 2: no Game Changers, no mass land denial, and no extra turns.'
      : `Assessed from ${signals.length} signal${signals.length === 1 ? '' : 's'} in the decklist.`;

  return { bracket, name: BRACKET_NAMES[bracket], signals, unchecked, summary };
}
