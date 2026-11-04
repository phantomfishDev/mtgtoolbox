import { normalizeName } from '../printed/types.js';
import { splitCardLine } from './parse.js';

/**
 * Pinning a printing by rewriting the decklist.
 *
 * The decklist text is the single source of truth for which printing a deck
 * uses: `1 Sol Ring (LTC) 284` is the pin. Keeping pins anywhere else would
 * mean the file a person edits and the file the app reads could disagree, and
 * the file is the thing that gets committed, diffed and pasted elsewhere.
 *
 * So the UI's "pin this printing" is a text rewrite, and the only difference
 * between running against a local server and running against a static site is
 * whether the rewritten text reaches disk.
 */

export interface DeckPin {
  /** Lowercase set code. */
  set: string;
  collectorNumber: string;
}

/** Pins keyed by normalised card name. */
export type DeckPins = Record<string, DeckPin>;

/**
 * Pins layered over whatever a decklist already says.
 *
 * `null` means *explicitly unpinned*, which absence cannot express: a card
 * missing from the overlay keeps the printing the list names, so clearing one
 * has to be recorded rather than forgotten.
 */
export type DeckPinOverlay = Readonly<Record<string, DeckPin | null>>;

function formatPin(pin: DeckPin): string {
  return ` (${pin.set.toUpperCase()}) ${pin.collectorNumber}`;
}

/** The pins a decklist already names inline. */
export function readPins(text: string): DeckPins {
  const pins: DeckPins = {};
  for (const raw of text.split(/\r?\n/)) {
    const parts = splitCardLine(raw);
    if (!parts?.set || !parts.collectorNumber) continue;
    pins[normalizeName(parts.name)] = {
      set: parts.set,
      collectorNumber: parts.collectorNumber,
    };
  }
  return pins;
}

/**
 * Set or clear the printing on every line naming one card.
 *
 * `null` removes the suffix, handing the card back to the preference scorer.
 * Lines that name other cards, comments and blank lines come through byte for
 * byte: this edits a file someone wrote by hand, so it must not reformat it.
 */
export function setPinInDecklist(
  text: string,
  cardName: string,
  pin: DeckPin | null,
): string {
  const target = normalizeName(cardName);
  // Splitting on a lookahead-free pattern loses which line ending was used, so
  // capture and re-emit each one.
  const lines = text.split(/(\r?\n)/);

  for (let index = 0; index < lines.length; index += 2) {
    const raw = lines[index] ?? '';
    const parts = splitCardLine(raw);
    if (!parts || normalizeName(parts.name) !== target) continue;
    lines[index] =
      parts.indent +
      parts.quantityText +
      parts.name +
      (pin ? formatPin(pin) : '') +
      parts.gap +
      parts.comment;
  }

  return lines.join('');
}

/** Apply a whole overlay, leaving cards it does not mention untouched. */
export function applyPins(text: string, pins: DeckPinOverlay): string {
  let out = text;
  for (const [name, pin] of Object.entries(pins)) {
    out = setPinInDecklist(out, name, pin);
  }
  return out;
}

/** True when the decklist names this card at all. */
export function decklistNames(text: string, cardName: string): boolean {
  const target = normalizeName(cardName);
  return text
    .split(/\r?\n/)
    .some((raw) => normalizeName(splitCardLine(raw)?.name ?? '') === target);
}
