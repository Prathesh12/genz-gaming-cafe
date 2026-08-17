import { describe, expect, it } from "vitest";

import { detectDelimiter, parseDelimited, toSheet } from "@/lib/csv";
import {
  detectColumns,
  detectDateOrder,
  membershipTermFor,
  normaliseMobile,
  parseMembers,
  parseSheetDate,
} from "@/lib/member-import";

/**
 * Reading a cafe's own membership spreadsheet.
 *
 * These tests are deliberately fussy about dates. Five hundred expiry dates
 * silently shifted by a day/month swap would be discovered months later, one
 * angry customer at a time.
 */

describe("reading exported spreadsheets", () => {
  it("handles a plain Google Sheets export", () => {
    const csv = "Name,Mobile\nArjun Rao,9876543210\nPriya Nair,9876543211\n";
    expect(toSheet(csv)).toEqual({
      headers: ["Name", "Mobile"],
      rows: [
        ["Arjun Rao", "9876543210"],
        ["Priya Nair", "9876543211"],
      ],
    });
  });

  it("keeps commas that are inside quotes", () => {
    const csv = 'Name,Address\n"Rao, Arjun","12 Main St, Kochi"\n';
    expect(toSheet(csv).rows[0]).toEqual(["Rao, Arjun", "12 Main St, Kochi"]);
  });

  it("handles doubled quotes, CRLF and a byte-order mark", () => {
    const csv = '﻿Name,Notes\r\n"Arjun ""AJ"" Rao",regular\r\n';
    const sheet = toSheet(csv);
    expect(sheet.headers).toEqual(["Name", "Notes"]);
    expect(sheet.rows[0]).toEqual(['Arjun "AJ" Rao', "regular"]);
  });

  it("handles a newline inside a quoted cell", () => {
    const csv = 'Name,Notes\n"Arjun Rao","line one\nline two"\n';
    expect(toSheet(csv).rows).toHaveLength(1);
    expect(toSheet(csv).rows[0][1]).toBe("line one\nline two");
  });

  it("reads a selection pasted straight out of Sheets, which uses tabs", () => {
    const tsv = "Name\tMobile\nArjun Rao\t9876543210\n";
    expect(detectDelimiter(tsv)).toBe("\t");
    expect(toSheet(tsv).rows[0]).toEqual(["Arjun Rao", "9876543210"]);
  });

  it("is not fooled into choosing comma by a comma inside a quoted header", () => {
    expect(detectDelimiter('"Name, full"\tMobile\tDOB\n')).toBe("\t");
  });

  it("drops blank lines and a trailing newline", () => {
    expect(parseDelimited("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("copes with an empty file", () => {
    expect(toSheet("")).toEqual({ headers: [], rows: [] });
  });
});

describe("working out which column is which", () => {
  it("finds the obvious ones", () => {
    const mapping = detectColumns(["Name", "Mobile Number", "DOB", "Start Date", "Expiry Date", "Amount Paid"]);
    expect(mapping).toMatchObject({
      fullName: 0,
      mobile: 1,
      dateOfBirth: 2,
      membershipStart: 3,
      membershipEnd: 4,
      price: 5,
    });
  });

  it("copes with the way people really label things", () => {
    const mapping = detectColumns([
      "S.No",
      "Customer Name",
      "WhatsApp No.",
      "Date of Joining",
      "Valid Till",
      "Aadhar Number",
      "Remarks",
    ]);
    expect(mapping.fullName).toBe(1);
    expect(mapping.mobile).toBe(2);
    expect(mapping.membershipStart).toBe(3);
    expect(mapping.membershipEnd).toBe(4);
    expect(mapping.aadhaar).toBe(5);
    expect(mapping.notes).toBe(6);
  });

  it("never uses one column for two fields", () => {
    const mapping = detectColumns(["Name", "Member Name", "Phone"]);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it("leaves fields unmapped when the sheet has no such column", () => {
    const mapping = detectColumns(["Name", "Mobile"]);
    expect(mapping.aadhaar).toBeUndefined();
    expect(mapping.membershipEnd).toBeUndefined();
  });
});

describe("reading dates", () => {
  it("reads the unambiguous formats", () => {
    expect(parseSheetDate("2026-08-15")?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(parseSheetDate("15 Aug 2026")?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(parseSheetDate("Aug 15, 2026")?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(parseSheetDate("15-August-2026")?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("reads day-first and month-first numeric dates as told", () => {
    expect(parseSheetDate("08/09/2026", "DMY")?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(parseSheetDate("08/09/2026", "MDY")?.toISOString()).toBe("2026-08-09T00:00:00.000Z");
  });

  it("proves the order from the column when one row settles it", () => {
    expect(detectDateOrder(["01/02/2026", "15/08/2026", "03/04/2026"])).toEqual({ order: "DMY", certain: true });
    expect(detectDateOrder(["01/02/2026", "08/15/2026"])).toEqual({ order: "MDY", certain: true });
  });

  it("admits when the column cannot settle it", () => {
    // Every value works either way — the preview has to say so.
    expect(detectDateOrder(["01/02/2026", "03/04/2026"])).toEqual({ order: "DMY", certain: false });
  });

  it("ignores spelled-out months when deciding the order", () => {
    expect(detectDateOrder(["15 Aug 2026", "01/02/2026"]).certain).toBe(false);
  });

  it("expands two-digit years sensibly", () => {
    expect(parseSheetDate("15/08/26")?.getUTCFullYear()).toBe(2026);
    expect(parseSheetDate("15/08/99")?.getUTCFullYear()).toBe(1999);
  });

  it("rejects dates that do not exist", () => {
    expect(parseSheetDate("31/02/2026")).toBeNull();
    expect(parseSheetDate("32/01/2026")).toBeNull();
    expect(parseSheetDate("not a date")).toBeNull();
    expect(parseSheetDate("")).toBeNull();
  });

  it("still reads a day-first date when told the column is month-first", () => {
    // A stray "15/08" in an otherwise month-first column is not worth losing.
    expect(parseSheetDate("15/08/2026", "MDY")?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });
});

describe("mobile numbers", () => {
  it("accepts the ways people type them", () => {
    expect(normaliseMobile("9876543210")).toBe("9876543210");
    expect(normaliseMobile("+91 98765 43210")).toBe("9876543210");
    expect(normaliseMobile("091-9876543210")).toBe("9876543210");
    expect(normaliseMobile(" 98765-43210 ")).toBe("9876543210");
  });

  it("rejects what is not a mobile number", () => {
    expect(normaliseMobile("12345")).toBeNull();
    expect(normaliseMobile("1234567890")).toBeNull(); // does not start 6-9
    expect(normaliseMobile("")).toBeNull();
  });
});

describe("reading the rows", () => {
  const headers = ["Name", "Mobile", "DOB", "Start Date", "Expiry", "Aadhaar", "Amount"];
  const mapping = detectColumns(headers);

  it("reads a complete row", () => {
    const { members } = parseMembers(
      [["Arjun Rao", "9876543210", "12/03/1998", "11/06/2026", "11/06/2027", "1234 5678 9012", "999"]],
      mapping,
    );
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      line: 2,
      fullName: "Arjun Rao",
      mobile: "9876543210",
      dateOfBirth: "1998-03-12",
      price: 99_900,
      aadhaar: "123456789012",
      warnings: [],
    });
    expect(members[0].membershipEnd?.toISOString()).toBe("2027-06-11T00:00:00.000Z");
  });

  it("keeps the member when only optional fields are missing", () => {
    // Exactly the case the cafe asked for: no Aadhaar recorded for this one.
    const { members, rejected } = parseMembers(
      [["Priya Nair", "9876543211", "05/09/1999", "01/01/2026", "01/01/2027", "", ""]],
      mapping,
    );
    expect(rejected).toHaveLength(0);
    expect(members[0].aadhaar).toBeNull();
    expect(members[0].price).toBe(0);
    expect(members[0].warnings).toEqual([]);
  });

  it("keeps the member but flags a malformed Aadhaar", () => {
    const { members, rejected } = parseMembers(
      [["Rahul Kumar", "9876543212", "", "", "01/01/2027", "1234", ""]],
      mapping,
    );
    expect(rejected).toHaveLength(0);
    expect(members[0].fullName).toBe("Rahul Kumar");
    expect(members[0].aadhaar).toBeNull();
    expect(members[0].warnings.join(" ")).toContain("Aadhaar");
  });

  it("rejects only rows with no name or no usable mobile", () => {
    const { members, rejected } = parseMembers(
      [
        ["", "9876543210", "", "", "", "", ""],
        ["No Phone", "", "", "", "", "", ""],
        ["Bad Phone", "12345", "", "", "", "", ""],
        ["Good One", "9876543299", "", "", "", "", ""],
      ],
      mapping,
    );
    expect(members.map((member) => member.fullName)).toEqual(["Good One"]);
    expect(rejected).toHaveLength(3);
    expect(rejected[0].line).toBe(2);
    expect(rejected[2].reason).toContain("not a 10-digit");
  });

  it("catches the same number twice in one sheet", () => {
    const { members, rejected } = parseMembers(
      [
        ["Arjun Rao", "9876543210", "", "", "", "", ""],
        ["Arjun R", "98765 43210", "", "", "", "", ""],
      ],
      mapping,
    );
    expect(members).toHaveLength(1);
    expect(rejected[0].reason).toContain("line 2");
  });

  it("skips blank lines without complaining", () => {
    const { members, rejected } = parseMembers(
      [["", "", "", "", "", "", ""], ["Arjun Rao", "9876543210", "", "", "", "", ""]],
      mapping,
    );
    expect(members).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("uses the whole sheet to settle the date order", () => {
    const { members, dateOrder, dateOrderCertain } = parseMembers(
      [
        ["Arjun Rao", "9876543210", "", "01/02/2026", "01/02/2027", "", ""],
        ["Priya Nair", "9876543211", "", "25/12/2026", "25/12/2027", "", ""],
      ],
      mapping,
    );
    expect(dateOrder).toBe("DMY");
    expect(dateOrderCertain).toBe(true);
    // 01/02 is therefore 1 February, not 2 January.
    expect(members[0].membershipStart?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("obeys an explicitly chosen date order", () => {
    const { members } = parseMembers(
      [["Arjun Rao", "9876543210", "", "01/02/2026", "", "", ""]],
      mapping,
      { dateOrder: "MDY" },
    );
    expect(members[0].membershipStart?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("flags an expiry that is not after the start", () => {
    const { members } = parseMembers(
      [["Arjun Rao", "9876543210", "", "01/01/2027", "01/01/2026", "", ""]],
      mapping,
    );
    expect(members[0].warnings.join(" ")).toContain("not after the start");
    expect(members[0].membershipStart).toBeNull();
    expect(members[0].membershipEnd?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("working out the membership term", () => {
  const base = {
    line: 2,
    fullName: "Arjun Rao",
    mobile: "9876543210",
    dateOfBirth: null,
    price: 0,
    aadhaar: null,
    address: null,
    notes: null,
    warnings: [],
  };
  const day = 86_400_000;

  it("uses both dates when the sheet has both", () => {
    const term = membershipTermFor(
      { ...base, membershipStart: new Date("2026-01-01T00:00:00Z"), membershipEnd: new Date("2027-01-01T00:00:00Z") },
      365,
    );
    expect(term?.startDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(term?.endDate.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("counts backwards from an expiry-only sheet, so the term keeps its length", () => {
    const end = new Date("2027-01-01T00:00:00Z");
    const term = membershipTermFor({ ...base, membershipStart: null, membershipEnd: end }, 365);
    expect(term?.endDate.toISOString()).toBe(end.toISOString());
    expect(term?.startDate.toISOString()).toBe(new Date(end.getTime() - 365 * day).toISOString());
  });

  it("runs forward from a start-only sheet", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const term = membershipTermFor({ ...base, membershipStart: start, membershipEnd: null }, 365);
    expect(term?.startDate.toISOString()).toBe(start.toISOString());
    expect(term?.endDate.toISOString()).toBe(new Date(start.getTime() + 365 * day).toISOString());
  });

  it("creates no membership when the sheet has no dates at all", () => {
    expect(membershipTermFor({ ...base, membershipStart: null, membershipEnd: null }, 365)).toBeNull();
  });
});
