/**
 * Turning a cafe's own spreadsheet into members.
 *
 * Everything here is pure: no database, no dates from the system clock unless
 * they are passed in. That matters because this code decides what five hundred
 * real customer records will look like, and a silent misreading — a day/month
 * swap that moves every expiry date — is far worse than a loud failure.
 */

export const IMPORT_FIELDS = [
  "fullName",
  "mobile",
  "dateOfBirth",
  "membershipStart",
  "membershipEnd",
  "price",
  "aadhaar",
  "address",
  "notes",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** What each field is called in the spreadsheets people actually keep. */
const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  fullName: ["name", "full name", "customer name", "member name", "student name", "customer", "member"],
  mobile: [
    "mobile",
    "mobile number",
    "mobile no",
    "phone",
    "phone number",
    "phone no",
    "contact",
    "contact number",
    "contact no",
    "whatsapp",
    "whatsapp number",
    "number",
  ],
  dateOfBirth: ["dob", "date of birth", "birth date", "birthday", "born"],
  membershipStart: [
    "start date",
    "start",
    "membership start",
    "membership start date",
    "joined",
    "joining date",
    "join date",
    "date of joining",
    "from",
    "valid from",
    "issued",
    "issue date",
  ],
  membershipEnd: [
    "end date",
    "end",
    "expiry",
    "expiry date",
    "expires",
    "expires on",
    "valid until",
    "valid till",
    "valid upto",
    "validity",
    "membership end",
    "membership end date",
    "renewal date",
    "due date",
    "to",
  ],
  price: ["price", "amount", "amount paid", "paid", "fee", "fees", "membership fee", "membership amount", "charge"],
  aadhaar: ["aadhaar", "aadhar", "adhaar", "adhar", "aadhaar number", "aadhar number", "aadhaar no", "uid"],
  address: ["address", "addr", "location", "area"],
  notes: ["notes", "note", "remarks", "remark", "comment", "comments"],
};

/** Compare headers the way a person would: ignoring case, spaces and punctuation. */
function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ColumnMapping = Partial<Record<ImportField, number>>;

/**
 * Work out which column holds which field.
 *
 * An exact match on a known name wins; otherwise a header that contains one is
 * accepted. A column is never used for two fields, and "name" is matched before
 * the looser options so a sheet with both "Name" and "Member Name" does not end
 * up using the wrong one.
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const normalised = headers.map(normaliseHeader);
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();

  const claim = (field: ImportField, index: number) => {
    mapping[field] = index;
    taken.add(index);
  };

  for (const pass of ["exact", "contains"] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field] !== undefined) continue;

      for (const synonym of HEADER_SYNONYMS[field]) {
        const index = normalised.findIndex((header, position) => {
          if (taken.has(position)) return false;
          return pass === "exact" ? header === synonym : header.includes(synonym);
        });
        if (index !== -1) {
          claim(field, index);
          break;
        }
      }
    }
  }

  return mapping;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

export type DateOrder = "DMY" | "MDY";

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

type DateParts = { year: number; month: number; day: number };

/** Pull the numbers out of a date cell without yet deciding what they mean. */
function rawDateParts(value: string): { a: number; b: number; year: number; explicitMonth?: number } | null {
  const text = value.trim();
  if (!text) return null;

  // 2026-08-15 — unambiguous, and what Google Sheets exports by default.
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (iso) return { a: Number(iso[3]), b: Number(iso[2]), year: Number(iso[1]), explicitMonth: Number(iso[2]) };

  // 15 Aug 2026 / Aug 15, 2026 — the month is spelled out, so nothing to guess.
  const named = /^(\d{1,2})[\s-]*([a-z]+)[\s,-]*(\d{2,4})$/i.exec(text);
  if (named && MONTH_NAMES[named[2].toLowerCase()]) {
    return { a: Number(named[1]), b: MONTH_NAMES[named[2].toLowerCase()], year: Number(named[3]), explicitMonth: MONTH_NAMES[named[2].toLowerCase()] };
  }
  const namedFirst = /^([a-z]+)[\s-]*(\d{1,2})[\s,-]*(\d{2,4})$/i.exec(text);
  if (namedFirst && MONTH_NAMES[namedFirst[1].toLowerCase()]) {
    return { a: Number(namedFirst[2]), b: MONTH_NAMES[namedFirst[1].toLowerCase()], year: Number(namedFirst[3]), explicitMonth: MONTH_NAMES[namedFirst[1].toLowerCase()] };
  }

  // 15/08/2026 or 08/15/2026 — genuinely ambiguous on its own.
  const slashed = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (slashed) return { a: Number(slashed[1]), b: Number(slashed[2]), year: Number(slashed[3]) };

  return null;
}

function expandYear(year: number): number {
  if (year >= 1000) return year;
  // A two-digit year in a cafe's membership sheet is this century.
  return year < 70 ? 2000 + year : 1900 + year;
}

function isRealDate({ year, month, day }: DateParts): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Decide whether a column of dates is day-first or month-first by looking at
 * the whole column, not each cell.
 *
 * One `15/08/2026` proves the column is day-first, because there is no
 * fifteenth month. If nothing in the column settles it, day-first is assumed —
 * that is how dates are written in India, and the preview states the reading
 * so it can be corrected before anything is imported.
 */
export function detectDateOrder(values: string[]): { order: DateOrder; certain: boolean } {
  let dayFirstProof = false;
  let monthFirstProof = false;

  for (const value of values) {
    const parts = rawDateParts(value);
    if (!parts || parts.explicitMonth !== undefined) continue;
    if (parts.a > 12 && parts.b <= 12) dayFirstProof = true;
    if (parts.b > 12 && parts.a <= 12) monthFirstProof = true;
  }

  if (dayFirstProof && !monthFirstProof) return { order: "DMY", certain: true };
  if (monthFirstProof && !dayFirstProof) return { order: "MDY", certain: true };
  return { order: "DMY", certain: false };
}

/**
 * Read one date cell as a UTC midnight instant, or null if it is not a date.
 * `order` only matters for the ambiguous numeric forms.
 */
export function parseSheetDate(value: string, order: DateOrder = "DMY"): Date | null {
  const parts = rawDateParts(value);
  if (!parts) return null;

  const year = expandYear(parts.year);
  let day: number;
  let month: number;

  if (parts.explicitMonth !== undefined) {
    month = parts.explicitMonth;
    day = parts.a;
  } else if (order === "DMY") {
    day = parts.a;
    month = parts.b;
  } else {
    month = parts.a;
    day = parts.b;
  }

  // A month-first reading of "15/08" is impossible; fall back rather than
  // throwing away a row over a setting.
  if (month > 12 && day <= 12) [day, month] = [month, day];

  if (!isRealDate({ year, month, day })) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

export type ParsedMember = {
  /** 1-based line number in the sheet, so a problem can be pointed at. */
  line: number;
  fullName: string;
  mobile: string;
  dateOfBirth: string | null;
  membershipStart: Date | null;
  membershipEnd: Date | null;
  /** Minor units. Zero when the sheet has no price column. */
  price: number;
  aadhaar: string | null;
  address: string | null;
  notes: string | null;
  /**
   * Fields that were present but unusable — a malformed Aadhaar, an
   * unreadable date. The member is still imported; these are reported so the
   * owner knows what to fill in later.
   */
  warnings: string[];
};

export type RejectedRow = { line: number; reason: string; name: string; mobile: string };

export type ParsedSheet = {
  members: ParsedMember[];
  rejected: RejectedRow[];
  dateOrder: DateOrder;
  dateOrderCertain: boolean;
};

/** Indian mobile numbers, however they were typed into the sheet. */
export function normaliseMobile(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

function cleanAadhaar(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return /^\d{12}$/.test(digits) ? digits : null;
}

function toPaise(value: string): number | null {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}

/**
 * Read every row.
 *
 * A row is only rejected when it has no usable name or no usable mobile
 * number — the two things a member record cannot exist without. Anything else
 * missing or malformed is dropped from that one field and noted, so a customer
 * whose Aadhaar was never recorded still comes across with their name, number
 * and dates intact.
 */
export function parseMembers(
  rows: string[][],
  mapping: ColumnMapping,
  options: { dateOrder?: DateOrder } = {},
): ParsedSheet {
  const dateColumns = [mapping.membershipStart, mapping.membershipEnd, mapping.dateOfBirth].filter(
    (index): index is number => index !== undefined,
  );
  const sampled = rows.flatMap((row) => dateColumns.map((index) => cell(row, index))).filter(Boolean);
  const detected = detectDateOrder(sampled);
  const dateOrder = options.dateOrder ?? detected.order;

  const members: ParsedMember[] = [];
  const rejected: RejectedRow[] = [];
  const seenMobiles = new Map<string, number>();

  rows.forEach((row, position) => {
    // +2: one for the header line, one because people count from 1.
    const line = position + 2;
    const rawName = cell(row, mapping.fullName);
    const rawMobile = cell(row, mapping.mobile);
    const name = rawName.replace(/\s+/g, " ").trim();
    const mobile = normaliseMobile(rawMobile);

    if (!name && !mobile && row.every((value) => !value.trim())) return; // blank line

    if (name.length < 2) {
      rejected.push({ line, reason: "No name in this row.", name: rawName, mobile: rawMobile });
      return;
    }
    if (!mobile) {
      rejected.push({
        line,
        reason: rawMobile
          ? `"${rawMobile}" is not a 10-digit Indian mobile number.`
          : "No mobile number in this row.",
        name,
        mobile: rawMobile,
      });
      return;
    }

    const firstSeen = seenMobiles.get(mobile);
    if (firstSeen !== undefined) {
      rejected.push({
        line,
        reason: `Same mobile number as line ${firstSeen} in this sheet.`,
        name,
        mobile,
      });
      return;
    }
    seenMobiles.set(mobile, line);

    const warnings: string[] = [];

    const rawDob = cell(row, mapping.dateOfBirth);
    const dob = rawDob ? parseSheetDate(rawDob, dateOrder) : null;
    if (rawDob && !dob) warnings.push(`date of birth "${rawDob}" could not be read`);

    const rawStart = cell(row, mapping.membershipStart);
    const start = rawStart ? parseSheetDate(rawStart, dateOrder) : null;
    if (rawStart && !start) warnings.push(`start date "${rawStart}" could not be read`);

    const rawEnd = cell(row, mapping.membershipEnd);
    const end = rawEnd ? parseSheetDate(rawEnd, dateOrder) : null;
    if (rawEnd && !end) warnings.push(`expiry date "${rawEnd}" could not be read`);

    const rawAadhaar = cell(row, mapping.aadhaar);
    const aadhaar = rawAadhaar ? cleanAadhaar(rawAadhaar) : null;
    if (rawAadhaar && !aadhaar) warnings.push("Aadhaar number is not 12 digits — left blank");

    const rawPrice = cell(row, mapping.price);
    const price = rawPrice ? toPaise(rawPrice) : null;
    if (rawPrice && price === null) warnings.push(`amount "${rawPrice}" could not be read`);

    if (start && end && end.getTime() <= start.getTime()) {
      warnings.push("expiry date is not after the start date — start date ignored");
    }

    members.push({
      line,
      fullName: name,
      mobile,
      dateOfBirth: dob ? dob.toISOString().slice(0, 10) : null,
      membershipStart: start && end && end.getTime() <= start.getTime() ? null : start,
      membershipEnd: end,
      price: price ?? 0,
      aadhaar,
      address: cell(row, mapping.address) || null,
      notes: cell(row, mapping.notes) || null,
      warnings,
    });
  });

  return {
    members,
    rejected,
    dateOrder,
    dateOrderCertain: options.dateOrder ? true : detected.certain,
  };
}

/**
 * Work out the membership term to record.
 *
 * Both dates present is the easy case. With only an expiry, the term is
 * counted backwards from it so the customer keeps the length they paid for.
 * With only a start, it runs forward by the cafe's default term. With neither,
 * no membership is created and the member is imported without one.
 */
export function membershipTermFor(
  member: ParsedMember,
  defaultDays: number,
): { startDate: Date; endDate: Date } | null {
  const day = 86_400_000;

  if (member.membershipStart && member.membershipEnd) {
    return { startDate: member.membershipStart, endDate: member.membershipEnd };
  }
  if (member.membershipEnd) {
    return {
      startDate: new Date(member.membershipEnd.getTime() - defaultDays * day),
      endDate: member.membershipEnd,
    };
  }
  if (member.membershipStart) {
    return {
      startDate: member.membershipStart,
      endDate: new Date(member.membershipStart.getTime() + defaultDays * day),
    };
  }
  return null;
}
