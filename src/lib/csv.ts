/**
 * A small, dependency-free reader for the files people actually export.
 *
 * Google Sheets, Excel and Numbers all produce slightly different CSV: a
 * leading byte-order mark, CRLF line endings, quoted fields containing commas
 * or newlines, and doubled quotes to escape a quote. Pasting a selection
 * straight out of Sheets gives tabs instead of commas. All of that is handled
 * here so the rest of the import can work with plain rows of strings.
 */

/** Strip the byte-order mark Excel likes to put at the front of a CSV. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess the separator by counting candidates outside quoted sections on the
 * header line. Counting blindly would be fooled by a comma inside "Rao, Arjun".
 */
export function detectDelimiter(text: string): string {
  const candidates = [",", "\t", ";", "|"];
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";

  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse delimited text into rows. Blank lines are dropped; a trailing newline
 * does not produce a phantom empty row.
 */
export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field.trim());
    field = "";
  };
  const endRow = () => {
    endField();
    // A line of nothing but separators carries no data.
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
  }

  // Whatever is left when the text runs out is the final row.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

export type Sheet = {
  headers: string[];
  rows: string[][];
};

/** Split parsed rows into a header line and the data beneath it. */
export function toSheet(text: string): Sheet {
  const rows = parseDelimited(text);
  if (rows.length === 0) return { headers: [], rows: [] };
  const [headers, ...rest] = rows;
  return { headers, rows: rest };
}
