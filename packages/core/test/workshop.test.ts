import { describe, expect, it } from 'vitest';
import {
  addPick,
  applyProposal,
  isCut,
  keptCards,
  newWorkshopSession,
  parseWorkshopProposal,
  parseWorkshopSession,
  phaseOwner,
  proposalSize,
  proposalToDecklist,
  replaceProposal,
  saveBrief,
  saveReview,
  submitBrief,
  submitReview,
  type WorkshopProposal,
  type WorkshopSession,
} from '../src/workshop/types.js';

const proposal = (cards: WorkshopProposal['cards']): WorkshopProposal =>
  parseWorkshopProposal({ summary: 'a deck', cards });

/** A session that has been through a brief and one proposal. */
function proposed(): WorkshopSession {
  const session = submitBrief(newWorkshopSession('thranduil-elf', 'Thranduil'), {
    ...newWorkshopSession('x').brief,
    bracket: 3,
    theme: 'elves of the woodland realm',
  });
  return applyProposal(
    session,
    proposal([
      { name: 'Thranduil, Elvenking', role: 'Commander', note: 'the deck', quantity: 1 },
      { name: 'Sol Ring', role: 'Ramp', note: '', quantity: 1 },
      { name: 'Forest', role: 'Lands', note: '', quantity: 9 },
    ]),
  );
}

describe('the session file', () => {
  it('fills in every default from a bare slug', () => {
    const session = parseWorkshopSession({ slug: 'new-deck' });
    expect(session.phase).toBe('intake');
    expect(session.round).toBe(0);
    expect(session.brief.bracket).toBe(3);
    expect(session.brief.include).toEqual([]);
    expect(session.proposal).toBeNull();
  });

  it('loads a session written by an older version', () => {
    // Only the slug is required; everything else has to survive being absent.
    const session = parseWorkshopSession({
      slug: 'rats',
      phase: 'proposed',
      round: 2,
      proposal: { cards: [{ name: 'Marrow-Gnawer' }] },
    });
    expect(session.proposal?.cards[0]?.quantity).toBe(1);
    expect(session.proposal?.cards[0]?.role).toBe('Deck');
    expect(session.review).toBeNull();
  });
});

describe('whose turn it is', () => {
  it('reads the turn off the phase', () => {
    expect(phaseOwner('intake')).toBe('user');
    expect(phaseOwner('briefed')).toBe('agent');
    expect(phaseOwner('proposed')).toBe('user');
    expect(phaseOwner('reviewed')).toBe('agent');
  });

  it('keeps the turn on a save but hands it over on a submit', () => {
    const session = newWorkshopSession('rats');
    const brief = { ...session.brief, theme: 'rats' };
    expect(saveBrief(session, brief).phase).toBe('intake');
    expect(submitBrief(session, brief).phase).toBe('briefed');
  });
});

describe('rounds', () => {
  it('numbers the round from the session, not the proposal', () => {
    const session = proposed();
    expect(session.round).toBe(1);
    expect(session.proposal?.round).toBe(1);

    // An agent that forgets to increment must not collapse two rounds into one.
    const second = applyProposal(session, proposal([{ name: 'Sol Ring', quantity: 1, role: 'Ramp', note: '' }]));
    expect(second.round).toBe(2);
    expect(second.proposal?.round).toBe(2);
  });

  it('files the review in history and clears it for the new round', () => {
    const reviewed = submitReview(proposed(), {
      ...parseWorkshopSession({ slug: 'x' }).review ?? {
        round: 1,
        cuts: [],
        comments: {},
        notes: '',
        answers: {},
        verdict: 'revise' as const,
      },
      round: 1,
      cuts: ['Sol Ring'],
      comments: { 'Sol Ring': 'too generic' },
      notes: 'more elves',
      answers: {},
      verdict: 'revise',
    });
    expect(reviewed.phase).toBe('reviewed');

    const next = applyProposal(reviewed, proposal([{ name: 'Lembas', quantity: 1, role: 'Ramp', note: '' }]));
    expect(next.review).toBeNull();
    expect(next.history).toHaveLength(1);
    expect(next.history[0]?.cuts).toEqual(['Sol Ring']);
    expect(next.history[0]?.notes).toBe('more elves');
  });

  it('accepting ends the loop', () => {
    const accepted = submitReview(proposed(), {
      round: 1,
      cuts: [],
      comments: {},
      notes: 'ship it',
      answers: {},
      verdict: 'accept',
    });
    expect(accepted.phase).toBe('accepted');
  });
});

describe('cuts', () => {
  const session = submitReview(proposed(), {
    round: 1,
    cuts: ['sol ring'],
    comments: {},
    notes: '',
    answers: {},
    verdict: 'revise',
  });

  it('matches a cut however the name was typed', () => {
    // The UI sends back the name it was given, but an agent writing a cut into
    // the file by hand will not reproduce the capitals.
    expect(isCut(session.review, 'Sol Ring')).toBe(true);
    expect(isCut(session.review, 'Forest')).toBe(false);
  });

  it('leaves the cut cards out of what was kept', () => {
    expect(keptCards(session).map((card) => card.name)).toEqual([
      'Thranduil, Elvenking',
      'Forest',
    ]);
  });

  it('counts copies rather than lines', () => {
    expect(proposalSize(session.proposal)).toBe(11);
  });
});

describe('picks', () => {
  it('ignores a card that is already on the list', () => {
    const brief = newWorkshopSession('x').brief;
    const once = addPick(brief, 'include', { name: 'Sol Ring', note: 'ramp' });
    const twice = addPick(once, 'include', { name: 'sol ring', note: 'again' });
    expect(twice.include).toHaveLength(1);
    expect(twice.include[0]?.note).toBe('ramp');
  });

  it('moves a card when the other list claims it', () => {
    const brief = addPick(newWorkshopSession('x').brief, 'avoid', { name: 'Sol Ring', note: '' });
    const moved = addPick(brief, 'include', { name: 'Sol Ring', note: 'changed my mind' });
    expect(moved.avoid).toHaveLength(0);
    expect(moved.include).toHaveLength(1);
  });
});

describe('the decklist it exports', () => {
  const session = submitReview(proposed(), {
    round: 1,
    cuts: ['Sol Ring'],
    comments: {},
    notes: '',
    answers: {},
    verdict: 'revise',
  });
  const text = proposalToDecklist(session);

  it('puts the commander under its own header', () => {
    expect(text).toContain('Commander\n1 Thranduil, Elvenking');
    expect(text).toContain('Deck\n9 Forest');
  });

  it('leaves cut cards out', () => {
    expect(text).not.toContain('Sol Ring');
  });

  it('records the brief as comments the parser ignores', () => {
    expect(text).toContain('# Thranduil');
    expect(text).toContain('# Bracket ceiling 3.');
    expect(text).toContain('# Theme: elves of the woodland realm');
  });

  it('writes a printing suffix only where the proposal pinned one', () => {
    const pinned = applyProposal(
      newWorkshopSession('rats'),
      proposal([
        { name: 'Marrow-Gnawer', role: 'Commander', note: '', quantity: 1, set: 'ltc', collectorNumber: '264' },
        { name: 'Swamp', role: 'Lands', note: '', quantity: 2 },
      ]),
    );
    const list = proposalToDecklist(pinned);
    expect(list).toContain('1 Marrow-Gnawer (LTC) 264');
    expect(list).toContain('2 Swamp\n');
  });
});

describe('correcting a round', () => {
  it('swaps the cards without advancing the round or touching the review', () => {
    const reviewing = saveReview(proposed(), {
      round: 1,
      cuts: ['Sol Ring'],
      comments: { 'Sol Ring': 'too generic' },
      notes: 'half way through',
      answers: {},
      verdict: 'revise',
    });

    const fixed = replaceProposal(
      reviewing,
      proposal([
        { name: 'Thranduil, Elvenking', role: 'Commander', note: 'corrected note', quantity: 1 },
        { name: 'Sol Ring', role: 'Ramp', note: '', quantity: 1 },
        { name: 'Forest', role: 'Lands', note: '', quantity: 9 },
      ]),
    );

    expect(fixed.round).toBe(1);
    expect(fixed.phase).toBe('proposed');
    expect(fixed.proposal?.round).toBe(1);
    expect(fixed.proposal?.cards[0]?.note).toBe('corrected note');
    // The half-written review survives the correction.
    expect(fixed.review?.cuts).toEqual(['Sol Ring']);
    expect(fixed.review?.notes).toBe('half way through');
    expect(fixed.history).toHaveLength(0);
  });

  it('refuses when there is no round to correct', () => {
    expect(() => replaceProposal(newWorkshopSession('x'), proposal([{ name: 'Sol Ring' } as never]))).toThrow(
      /no proposal to replace/,
    );
  });
});
