/**
 * Parse a student roster CSV into email addresses for Department enrollment.
 *
 * Accepted shapes:
 *   - a header row with a column whose name contains "email" (e.g. an LMS
 *     export with `First Name,Last Name,Email`) — only that column is read;
 *   - no header — every cell that looks like an email address is taken, so a
 *     plain one-address-per-line file works too.
 *
 * The server re-validates and normalizes every address; this parse only
 * drives the preview shown before import.
 */

const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export interface ParsedRoster {
  /** Unique, lower-cased email addresses in file order. */
  readonly emails: string[];
  /** Non-empty rows (or email-column values) that held no usable address. */
  readonly skipped: string[];
}

/** Split one CSV line into cells, honouring double-quoted fields. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Pick the delimiter that splits the first line into the most cells. */
function detectDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t']) {
    const count = firstLine.split(candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function isLikelyEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export function parseRosterCsv(text: string): ParsedRoster {
  const lines = text
    .replace(BYTE_ORDER_MARK, '')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { emails: [], skipped: [] };

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => splitCsvLine(line, delimiter));

  const header = rows[0];
  const emailColumn = header.findIndex(
    (cell) => /e-?mail/i.test(cell) && !isLikelyEmail(cell),
  );

  const seen = new Set<string>();
  const emails: string[] = [];
  const skipped: string[] = [];
  const add = (value: string) => {
    const email = value.trim().toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  };

  if (emailColumn >= 0) {
    for (const row of rows.slice(1)) {
      const value = row[emailColumn]?.trim() ?? '';
      if (isLikelyEmail(value)) add(value);
      else if (row.some((cell) => cell.length > 0)) skipped.push(value || row.join(', '));
    }
  } else {
    for (const row of rows) {
      const found = row.filter(isLikelyEmail);
      if (found.length > 0) found.forEach(add);
      else skipped.push(row.join(', '));
    }
  }

  return { emails, skipped };
}
