import { bareSectionHeader } from './parse.js';

/**
 * Write a `Tokens` section into a decklist, replacing any section already there.
 *
 * Decklists are files people edit, commit and diff, so this rewrites as little
 * as possible: the rest of the list is returned byte for byte, the file's
 * trailing-newline habit is preserved, and a section that already says the
 * right thing produces no change at all. Headers are recognised through the
 * parser's own rule, so the writer cannot drift from what the reader accepts.
 */
export function setTokensSection(text: string, lines: readonly string[]): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  // Handled separately rather than as a row, so that replacing a section at the
  // end of the file cannot swallow it.
  const trailing = /\r?\n$/.exec(text)?.[0] ?? '';
  const body = trailing ? text.slice(0, text.length - trailing.length) : text;
  const rows = body.split(/\r?\n/);

  // The `Tokens` header, and the extent of the section beneath it: it runs to
  // the next header or to the end of the list.
  let start = -1;
  let end = rows.length;
  for (let index = 0; index < rows.length; index += 1) {
    const section = bareSectionHeader(rows[index] ?? '');
    if (start === -1) {
      if (section === 'tokens') start = index;
      continue;
    }
    if (section !== undefined) {
      end = index;
      break;
    }
  }

  const block = lines.length > 0 ? ['Tokens', ...lines] : [];

  let replaced: string[];
  if (start === -1) {
    if (block.length === 0) return text;
    // Append, keeping exactly one blank line before the new section.
    const head = rows.slice();
    while (head.length > 0 && (head[head.length - 1] ?? '').trim() === '') head.pop();
    replaced = [...head, '', ...block];
  } else {
    const head = rows.slice(0, start);
    // Whatever followed the old section, minus the blank lines that separated
    // it, so a replacement does not accumulate them.
    const tail = rows.slice(end);
    while (tail.length > 0 && (tail[0] ?? '').trim() === '') tail.shift();
    if (block.length === 0) {
      while (head.length > 0 && (head[head.length - 1] ?? '').trim() === '') head.pop();
      replaced = tail.length > 0 ? [...head, '', ...tail] : head;
    } else {
      replaced = tail.length > 0 ? [...head, ...block, '', ...tail] : [...head, ...block];
    }
  }

  const out = replaced.join(newline) + trailing;
  // An unchanged result returns the original string, so callers can skip the write.
  return out === text ? text : out;
}
