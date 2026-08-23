import type { DeckEntry } from '../decklist/parse.js';
import type { ScryfallClient } from '../scryfall/client.js';
import type { ResolveResult, ResolvedCard, UnresolvedCard, ResolveWarning } from '../scryfall/resolve.js';
import type { ScryfallCard } from '../scryfall/types.js';
import { isDoubleFaced } from '../scryfall/types.js';
import { isBasicLand } from '../collection/diff.js';
import { normalizeName } from '../collection/types.js';
import type { PreferenceProfile } from './profile.js';
import { selectPrinting, type SelectionResult } from './score.js';

/**
 * Preference-aware deck resolution.
 *
 * The batch resolver in `scryfall/resolve.ts` asks Scryfall for one printing per
 * card and costs two requests per deck. This path instead asks for *every*
 * printing of each distinct name so the preference engine has something to rank,
 * which costs one request per distinct name. It is therefore only used when a
 * profile actually expresses a preference.
 */

export interface PreferenceResolveOptions {
  profile: PreferenceProfile;
  /** Scryfall ids or `set|collectorNumber` keys already in the collection. */
  ownedKeys?: ReadonlySet<string>;
  /** Card name -> pinned printing, overriding all scoring. */
  pins?: Record<string, { set: string; collectorNumber: string }>;
  onProgress?: (done: number, total: number, name: string) => void;
}

export interface PreferenceResolveResult extends ResolveResult {
  /** The ranking behind each choice, keyed by normalised card name. */
  selections: Map<string, SelectionResult>;
}

function pinnedFrom(
  candidates: readonly ScryfallCard[],
  set: string,
  collectorNumber: string,
): ScryfallCard | undefined {
  return candidates.find(
    (card) =>
      card.set.toLowerCase() === set.toLowerCase() &&
      card.collector_number.toLowerCase() === collectorNumber.toLowerCase(),
  );
}

export async function resolveDeckWithPreferences(
  entries: readonly DeckEntry[],
  client: ScryfallClient,
  options: PreferenceResolveOptions,
): Promise<PreferenceResolveResult> {
  const resolved: ResolvedCard[] = [];
  const unresolved: UnresolvedCard[] = [];
  const warnings: ResolveWarning[] = [];
  const selections = new Map<string, SelectionResult>();

  // One fetch per distinct name, however many entries reference it.
  const distinct = [...new Set(entries.map((entry) => normalizeName(entry.name)))];
  const printsByName = new Map<string, ScryfallCard[]>();
  let done = 0;
  for (const name of distinct) {
    const entry = entries.find((candidate) => normalizeName(candidate.name) === name)!;
    options.onProgress?.(done, distinct.length, entry.name);
    printsByName.set(name, await client.prints(entry.name));
    done += 1;
  }
  options.onProgress?.(done, distinct.length, '');

  for (const entry of entries) {
    const key = normalizeName(entry.name);
    let candidates = printsByName.get(key) ?? [];

    // A name the search endpoint does not know may still resolve fuzzily.
    if (candidates.length === 0) {
      const fuzzy = await client.named(entry.name);
      if (fuzzy) {
        candidates = await client.prints(fuzzy.name);
        if (candidates.length === 0) candidates = [fuzzy];
        printsByName.set(key, candidates);
      }
    }

    if (candidates.length === 0) {
      unresolved.push({ entry, reason: `no Scryfall match for "${entry.name}"` });
      continue;
    }

    // Precedence: an explicit printing on the line, then a saved pin, then scoring.
    const pin = options.pins?.[key];
    const explicit =
      entry.set && entry.collectorNumber
        ? pinnedFrom(candidates, entry.set, entry.collectorNumber)
        : undefined;
    const pinned = explicit ?? (pin ? pinnedFrom(candidates, pin.set, pin.collectorNumber) : undefined);

    if (entry.set && entry.collectorNumber && !explicit) {
      warnings.push({
        entry,
        card: candidates[0]!,
        code: 'pin-missed',
        message: `${entry.name}: no printing ${entry.set.toUpperCase()} ${entry.collectorNumber}; falling back to preferences`,
      });
    }

    let card: ScryfallCard;
    if (pinned) {
      card = pinned;
    } else {
      const isBasic = isBasicLand(candidates[0]!);
      const selection = selectPrinting(candidates, options.profile, {
        ...(options.ownedKeys ? { ownedKeys: options.ownedKeys } : {}),
        isBasic,
      });
      if (!selection) {
        unresolved.push({ entry, reason: `no printable version of "${entry.name}"` });
        continue;
      }
      selections.set(key, selection);
      card = selection.chosen;
      if (selection.relaxed) {
        warnings.push({
          entry,
          card,
          code: 'preferences-relaxed',
          message: `${card.name}: no printing satisfies every requirement; used ${card.set.toUpperCase()} ${card.collector_number}`,
        });
      }
    }

    resolved.push({ entry, card, via: pinned ? 'printing' : 'name' });
  }

  for (const item of resolved) {
    if (isDoubleFaced(item.card)) {
      warnings.push({
        entry: item.entry,
        card: item.card,
        code: 'double-faced',
        message: `${item.card.name} is double-faced; only the front face will be printed`,
      });
    }
    if (item.card.image_status !== 'highres_scan') {
      warnings.push({
        entry: item.entry,
        card: item.card,
        code: 'low-resolution',
        message: `${item.card.name} (${item.card.set.toUpperCase()}) has a ${item.card.image_status} image and will print poorly`,
      });
    }
  }

  return { resolved, unresolved, warnings, selections };
}

/**
 * True when a profile expresses anything that needs the full printing list.
 *
 * This decides between a two-request deck resolution and one request per
 * distinct card, so it deliberately ignores rules that cannot change which
 * printing wins. `preferOwned` is the subtle one: it is on by default, but with
 * an empty collection it can never affect the ranking, so it does not on its
 * own justify the expensive path.
 */
export function hasActivePreferences(
  profile: PreferenceProfile,
  context: { hasCollection?: boolean } = {},
): boolean {
  const tristate = (value: string | undefined): boolean => Boolean(value && value !== 'ignore');
  return Boolean(
    profile.preferSets?.length ||
      profile.avoidSets?.length ||
      profile.requireSets?.length ||
      profile.frameEffects?.length ||
      tristate(profile.fullArt) ||
      tristate(profile.borderless) ||
      tristate(profile.retroFrame) ||
      tristate(profile.promo) ||
      tristate(profile.universesBeyond) ||
      (profile.preferOwned && context.hasCollection) ||
      profile.basics,
  );
}
