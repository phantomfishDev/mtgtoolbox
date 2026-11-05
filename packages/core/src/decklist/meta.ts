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
 * # Name: The Hare Apparent
 * # Owner: Sam
 * # Azorius rabbits, bracket 3 or under.
 * ```
 */

/** A metadata key this module understands. Anything else stays prose. */
const DIRECTIVE_KEYS = new Set(['name', 'owner']);

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
  /** The deck's display name, when the file gives one. */
  name: string | null;
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
  let name: string | null = null;
  let owner: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank lines before the block are fine; one after it ends the block.
      if (prose.length > 0 || owner !== null || name !== null) break;
      continue;
    }
    if (!trimmed.startsWith('#')) break;

    const body = trimmed.replace(/^#\s?/, '');
    const directive = body.match(DIRECTIVE_RE);
    const key = directive?.[1]?.toLowerCase();

    if (directive && key && DIRECTIVE_KEYS.has(key)) {
      // Last one wins, so an edit appended to the block takes effect.
      const value = (directive[2] ?? '').trim() || null;
      if (key === 'owner') owner = value;
      if (key === 'name') name = value;
      continue;
    }

    prose.push(body.trim());
  }

  const note = prose.join(' ').trim();
  return { name, owner, note: note === '' ? null : note };
}

const NAME_RE = /^#\s?name\s*:/i;

/**
 * Set the deck's `# Name:` directive, or remove it with `null`.
 *
 * Every existing name directive in the leading block is dropped and the new one
 * written at the top of it, so the file ends up with exactly one. A file with
 * no leading block gets one, separated from the cards by a blank line. Nothing
 * else in the file moves, which keeps the edit a one-line diff.
 */
export function setDeckName(text: string, name: string | null): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // A name is one line of a comment; anything that would break out of it goes.
  const clean = name?.replace(/[\r\n]+/g, ' ').trim() || null;

  // Find the leading comment block with the same rules parseDeckMeta uses.
  let start = -1;
  let end = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed === '') {
      if (start >= 0) break;
      continue;
    }
    if (!trimmed.startsWith('#')) break;
    if (start < 0) start = i;
    end = i + 1;
  }

  if (start < 0) {
    if (clean === null) return text;
    return [`# Name: ${clean}`, '', ...lines].join(eol);
  }

  const block = lines.slice(start, end).filter((line) => !NAME_RE.test(line.trim()));
  if (clean !== null) block.unshift(`# Name: ${clean}`);

  let after = lines.slice(end);
  // Removing a block's only line would leave the blank that separated it.
  if (block.length === 0 && (after[0] ?? '').trim() === '') after = after.slice(1);
  return [...lines.slice(0, start), ...block, ...after].join(eol);
}
