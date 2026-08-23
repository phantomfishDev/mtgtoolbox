import type { ScryfallCard } from '../scryfall/types.js';
import { compareCollectorNumbers } from '../collection/types.js';
import { profileFor, type PreferenceProfile } from './profile.js';

/**
 * Scoring a printing against a preference profile.
 *
 * Weights are deliberately spread far apart so that the outcome is easy to
 * reason about: one strong preference always beats an accumulation of weak
 * ones, and `--explain` shows exactly which rules fired.
 */

/**
 * Scoring weights, ordered by intent.
 *
 * The hierarchy matters more than the absolute numbers: an explicit `avoid`
 * outranks every positive signal, including `preferOwned`. Someone who asks for
 * no Universes Beyond printings means it even if they happen to own one, so the
 * penalty has to exceed the ownership bonus rather than merely offset it.
 */
export const WEIGHTS = {
  /** Owning a copy is the strongest *positive* signal: proxies match real cards. */
  owned: 120,
  /** Scaled by position in `preferSets`, so the first listed set dominates. */
  setPreferenceTop: 100,
  setPreferenceStep: 10,
  highres: 60,
  fullArt: 40,
  borderless: 30,
  frameEffect: 25,
  retroFrame: 20,
  promo: 10,
  /** Applied per matching `avoid` rule; deliberately beats `owned`. */
  avoid: -150,
  /** Baseline junk categories such as memorabilia, which are never printable proxies. */
  avoidSetType: -200,
  wrongLanguage: -150,
  digital: -200,
} as const;

export interface ScoreReason {
  rule: string;
  delta: number;
  detail?: string;
}

export interface PrintingScore {
  card: ScryfallCard;
  score: number;
  reasons: ScoreReason[];
  /** Set when a `require` rule excluded this printing outright. */
  disqualified?: string;
}

export interface ScoreContext {
  /** Scryfall ids, or `set|collectorNumber` keys, already held. */
  ownedKeys?: ReadonlySet<string>;
  isBasic?: boolean;
}

export function isUniversesBeyond(card: ScryfallCard): boolean {
  return card.promo_types?.includes('universesbeyond') ?? false;
}

export function isBorderless(card: ScryfallCard): boolean {
  return card.border_color === 'borderless';
}

export function isRetroFrame(card: ScryfallCard): boolean {
  return card.frame === '1997';
}

function ownedKeysFor(card: ScryfallCard): string[] {
  return [card.id, `${card.set.toLowerCase()}|${card.collector_number.toLowerCase()}`];
}

/**
 * Apply one tri-state rule.
 *
 * `require` disqualifies when the trait is absent, `avoid` penalises when it is
 * present, and `prefer` rewards when it is present.
 */
function applyRule(
  preference: string | undefined,
  present: boolean,
  weight: number,
  rule: string,
  reasons: ScoreReason[],
): string | undefined {
  if (!preference || preference === 'ignore') return undefined;
  if (preference === 'require') {
    if (!present) return `requires ${rule}`;
    reasons.push({ rule, delta: weight });
    return undefined;
  }
  if (preference === 'avoid' && present) {
    reasons.push({ rule: `avoid ${rule}`, delta: WEIGHTS.avoid });
    return undefined;
  }
  if (preference === 'prefer' && present) reasons.push({ rule, delta: weight });
  return undefined;
}

export function scorePrinting(
  card: ScryfallCard,
  rawProfile: PreferenceProfile,
  context: ScoreContext = {},
): PrintingScore {
  const profile = profileFor(rawProfile, context.isBasic ?? false);
  const reasons: ScoreReason[] = [];
  let disqualified: string | undefined;

  const disqualify = (why: string | undefined): void => {
    if (why && !disqualified) disqualified = why;
  };

  if (profile.requireSets?.length && !profile.requireSets.includes(card.set.toLowerCase())) {
    disqualify(`not in required sets (${profile.requireSets.join(', ')})`);
  }

  if (profile.requireHighres && card.image_status !== 'highres_scan') {
    disqualify(`image is ${card.image_status}, not a high-resolution scan`);
  } else if (card.image_status === 'highres_scan') {
    reasons.push({ rule: 'high-resolution scan', delta: WEIGHTS.highres });
  }

  if (profile.lang && card.lang !== profile.lang) {
    reasons.push({ rule: 'wrong language', delta: WEIGHTS.wrongLanguage, detail: card.lang });
  }

  if (card.digital) reasons.push({ rule: 'digital-only printing', delta: WEIGHTS.digital });

  const preferIndex = profile.preferSets?.indexOf(card.set.toLowerCase()) ?? -1;
  if (preferIndex >= 0) {
    const delta = Math.max(
      WEIGHTS.setPreferenceStep,
      WEIGHTS.setPreferenceTop - preferIndex * WEIGHTS.setPreferenceStep,
    );
    reasons.push({ rule: 'preferred set', delta, detail: card.set.toUpperCase() });
  }
  if (profile.avoidSets?.includes(card.set.toLowerCase())) {
    reasons.push({ rule: 'avoided set', delta: WEIGHTS.avoid, detail: card.set.toUpperCase() });
  }
  if (profile.avoidSetTypes?.includes(card.set_type)) {
    reasons.push({ rule: 'avoided set type', delta: WEIGHTS.avoidSetType, detail: card.set_type });
  }

  disqualify(applyRule(profile.fullArt, card.full_art, WEIGHTS.fullArt, 'full art', reasons));
  disqualify(applyRule(profile.borderless, isBorderless(card), WEIGHTS.borderless, 'borderless', reasons));
  disqualify(applyRule(profile.retroFrame, isRetroFrame(card), WEIGHTS.retroFrame, 'retro frame', reasons));
  disqualify(applyRule(profile.textless, card.textless ?? false, 0, 'textless', reasons));
  disqualify(applyRule(profile.promo, card.promo, WEIGHTS.promo, 'promo', reasons));
  disqualify(
    applyRule(profile.universesBeyond, isUniversesBeyond(card), 0, 'Universes Beyond', reasons),
  );

  if (profile.frameEffects?.length) {
    const effects = card.frame_effects ?? [];
    const hit = profile.frameEffects.find((effect) => effects.includes(effect));
    if (hit) reasons.push({ rule: 'frame effect', delta: WEIGHTS.frameEffect, detail: hit });
  }

  if (profile.preferOwned && context.ownedKeys) {
    if (ownedKeysFor(card).some((key) => context.ownedKeys!.has(key))) {
      reasons.push({ rule: 'already owned', delta: WEIGHTS.owned });
    }
  }

  const score = reasons.reduce((sum, reason) => sum + reason.delta, 0);
  return { card, score, reasons, ...(disqualified ? { disqualified } : {}) };
}

/**
 * Deterministic ordering: score first, then newest printing, then the lowest
 * collector number. Without the tie-breaks the same deck could produce a
 * different PDF on each run.
 */
export function comparePrintings(a: PrintingScore, b: PrintingScore): number {
  return (
    b.score - a.score ||
    b.card.released_at.localeCompare(a.card.released_at) ||
    compareCollectorNumbers(a.card.collector_number, b.card.collector_number) ||
    a.card.id.localeCompare(b.card.id)
  );
}

export interface SelectionResult {
  chosen: ScryfallCard;
  ranked: PrintingScore[];
  /** True when every candidate failed a `require` rule and it had to be ignored. */
  relaxed: boolean;
}

/**
 * Pick the best printing.
 *
 * When hard rules exclude everything the rules are relaxed rather than leaving
 * a hole in the deck: an unwanted printing still beats a missing card, and the
 * caller is told so it can warn.
 */
export function selectPrinting(
  candidates: readonly ScryfallCard[],
  profile: PreferenceProfile,
  context: ScoreContext = {},
): SelectionResult | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((card) => scorePrinting(card, profile, context));
  const eligible = scored.filter((entry) => !entry.disqualified);
  const pool = eligible.length > 0 ? eligible : scored;
  const ranked = [...pool].sort(comparePrintings);
  return { chosen: ranked[0]!.card, ranked, relaxed: eligible.length === 0 };
}
