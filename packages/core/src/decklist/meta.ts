/**
 * Metadata a decklist carries about itself, written in its leading comments.
 *
 * These files are plain text that gets pasted into other tools — mtgprint.net,
 * Archidekt, Moxfield — so metadata cannot occupy a line of its own: a bare
 * `Owner: Sam` is read as a card named "Sam" by this project's own parser and
 * by every other list parser too. Writing it as a `#` comment instead keeps it
 * invisible to all of them, since every one of those tools already drops
 * comment lines.
 *
 * The syntax is one `Key: value` per comment line, in the comment block at the
 * top of the file:
 *
 * ```
 * # Owner: Sam
 * # The Hare Apparent — Azorius rabbits, bracket 3 or under.
 * ```
 */

/** A metadata key this module understands. Anything else stays prose. */
const DIRECTIVE_KEYS = new Set(['owner']);

/**
 * `# Owner: Sam` — the key anchored to the start of the comment.
 *
 * Anchoring is what stops prose from being mistaken for metadata: one of these
 * decks explains that it was "imported from <url> (owner: swebb)", which names
 * the author of the Archidekt list rather than whose deck this is, and must
 * stay in the note where a reader can see that distinction.
 */
const DIRECTIVE_RE = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/;

export interface DeckMeta {
  /** Whose deck this is, when the file says. */
  owner: string | null;
  /**
   * The leading comment block with any directives removed, as one paragraph.
   *
   * This is the deck's own description of itself, which is why it is worth
   * separating from the metadata rather than showing the raw comments.
   */
  note: string | null;
}

/**
 * Read the metadata and prose note out of a decklist's leading comments.
 *
 * Only the opening comment block is considered. Comments further down belong to
 * the cards they sit beside — the per-card theming notes these lists carry —
 * and a stray `Owner:` among them is far more likely to be a note about a card
 * than a claim about the whole deck.
 */
export function parseDeckMeta(text: string): DeckMeta {
  const prose: string[] = [];
  let owner: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank lines before the block are fine; one after it ends the block.
      if (prose.length > 0 || owner !== null) break;
      continue;
    }
    if (!trimmed.startsWith('#')) break;

    const body = trimmed.replace(/^#\s?/, '');
    const directive = body.match(DIRECTIVE_RE);
    const key = directive?.[1]?.toLowerCase();

    if (directive && key && DIRECTIVE_KEYS.has(key)) {
      // Last one wins, so an edit appended to the block takes effect.
      if (key === 'owner') owner = (directive[2] ?? '').trim() || null;
      continue;
    }

    prose.push(body.trim());
  }

  const note = prose.join(' ').trim();
  return { owner, note: note === '' ? null : note };
}
