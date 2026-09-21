/**
 * A small CSV reader and writer.
 *
 * Collection exports come from phone apps and spreadsheets, so the reader has
 * to cope with quoted fields containing commas and newlines, doubled quotes,
 * CRLF line endings and a leading byte-order mark. That rules out splitting on
 * commas, and pulling in a dependency for it would be heavier than the parser
 * itself.
 */

/** Parse CSV text into rows of raw string fields. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index]!;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRow();
      // Consume CRLF as one terminator.
      index += char === '\r' && input[index + 1] === '\n' ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // A file that does not end in a newline still has a final row to flush; one
  // that does must not gain an empty trailing row.
  if (field !== '' || quoted || row.length > 0) endRow();

  return rows.filter((candidate) => !(candidate.length === 1 && candidate[0] === ''));
}

/** Serialise rows to CSV, quoting only the fields that need it. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(escapeField).join(',')).join('\n')}\n`;
}

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/**
 * Fold a header cell to a comparison key.
 *
 * Trackers disagree about spacing and capitalisation — "Set code", "set_code"
 * and "SetCode" all mean the same column — so everything but letters and digits
 * is dropped before matching.
 */
export function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Index a header row by folded name, keeping the first of any duplicates so a
 * repeated column cannot shadow the one that came first.
 */
export function indexHeaders(header: readonly string[]): Map<string, number> {
  const columns = new Map<string, number>();
  header.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key && !columns.has(key)) columns.set(key, index);
  });
  return columns;
}
