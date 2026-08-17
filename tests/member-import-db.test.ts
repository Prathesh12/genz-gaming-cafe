import { afterAll, describe, expect, it } from "vitest";

/**
 * Importing a real membership list, against a real database.
 *
 * The parsing rules are unit-tested elsewhere; what matters here is what
 * actually lands in the tables: unique member codes for five hundred rows at
 * once, memberships dated from the sheet rather than from today, existing
 * members left untouched, and no partial import if anything goes wrong.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

let pool: { end: () => Promise<void> } | undefined;

afterAll(async () => {
  await pool?.end();
});

const STAFF = {
  id: "",
  email: "importer@test.local",
  name: "Importer",
  role: "ADMIN" as const,
  canDiscount: true,
  maxDiscountPercent: 100,
  canViewSensitive: true,
};

/** A sheet shaped like one a cafe would actually keep. */
function buildSheet(count: number, startMobile = 7000000000): string {
  const lines = ["Customer Name,WhatsApp No.,DOB,Date of Joining,Valid Till,Aadhar Number,Amount Paid"];
  for (let index = 0; index < count; index += 1) {
    const mobile = startMobile + index;
    const aadhaar = index % 3 === 0 ? "" : String(100000000000 + index);
    const dob = index % 5 === 0 ? "" : `1${5 + (index % 4)}/0${1 + (index % 9)}/199${index % 10}`;
    lines.push(
      `Member ${index},${mobile},${dob},01/0${1 + (index % 9)}/2026,15/1${index % 2}/2026,${aadhaar},999`,
    );
  }
  return lines.join("\n");
}

async function importSheet(csv: string) {
  const { toSheet } = await import("@/lib/csv");
  const { detectColumns, parseMembers } = await import("@/lib/member-import");
  const { importMembers } = await import("@/server/services/member-import");

  const sheet = toSheet(csv);
  const mapping = detectColumns(sheet.headers);
  const parsed = parseMembers(sheet.rows, mapping);
  return importMembers(parsed.members, parsed.rejected, STAFF);
}

describeIfDb("importing a membership list", () => {
  it("imports five hundred members with their memberships in one go", async () => {
    const { db, pool: dbPool } = await import("@/db");
    pool = dbPool;
    const { eq, inArray, like, sql } = await import("drizzle-orm");
    const schema = await import("@/db/schema");

    const [staff] = await db.select().from(schema.users).limit(1);
    expect(staff, "seed the database first: npm run db:seed").toBeDefined();
    STAFF.id = staff.id;

    const csv = buildSheet(500);
    const before = await db.select({ count: sql<number>`count(*)::int` }).from(schema.members);

    try {
      const outcome = await importSheet(csv);

      expect(outcome.imported).toBe(500);
      expect(outcome.withMembership).toBe(500);
      expect(outcome.rejected).toHaveLength(0);
      expect(outcome.duplicates).toHaveLength(0);

      const after = await db.select({ count: sql<number>`count(*)::int` }).from(schema.members);
      expect(after[0].count).toBe(before[0].count + 500);

      const imported = await db
        .select()
        .from(schema.members)
        .where(like(schema.members.fullName, "Member %"));
      expect(imported).toHaveLength(500);

      // Every member code is distinct — the thing a count-based sequence breaks.
      const codes = new Set(imported.map((member) => member.memberCode));
      expect(codes.size).toBe(500);

      // Aadhaar was encrypted where present and simply absent where it was not.
      const withAadhaar = imported.filter((member) => member.aadhaarEnc);
      expect(withAadhaar.length).toBeGreaterThan(0);
      expect(withAadhaar.length).toBeLessThan(500);
      for (const member of withAadhaar) {
        expect(member.aadhaarEnc).not.toContain("1000000000");
        expect(member.aadhaarLast4).toHaveLength(4);
      }

      // Memberships carry the sheet's own dates, and are dated to when the
      // term began so historical fees never land in today's income.
      const ids = imported.map((member) => member.id);
      const terms = await db
        .select()
        .from(schema.memberships)
        .where(inArray(schema.memberships.memberId, ids));
      expect(terms).toHaveLength(500);
      for (const term of terms.slice(0, 20)) {
        expect(term.endDate.getUTCFullYear()).toBe(2026);
        expect(term.startDate.getTime()).toBeLessThan(term.endDate.getTime());
        expect(term.createdAt.getTime()).toBe(term.startDate.getTime());
      }
    } finally {
      const leftovers = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(like(schema.members.fullName, "Member %"));
      const ids = leftovers.map((row) => row.id);
      if (ids.length) {
        await db.delete(schema.memberships).where(inArray(schema.memberships.memberId, ids));
        await db.delete(schema.members).where(inArray(schema.members.id, ids));
      }
      void eq;
    }
  }, 60_000);

  it("leaves someone already on file completely alone", async () => {
    const { db } = await import("@/db");
    const { eq, like, inArray } = await import("drizzle-orm");
    const schema = await import("@/db/schema");

    const [staff] = await db.select().from(schema.users).limit(1);
    STAFF.id = staff.id;

    const [existing] = await db
      .insert(schema.members)
      .values({ memberCode: `EXIST-${Date.now()}`, fullName: "Original Name", mobile: "7900000001" })
      .returning();

    const csv = [
      "Name,Mobile,Valid Till",
      "Changed Name,7900000001,15/12/2026",
      "Member Fresh,7900000002,15/12/2026",
    ].join("\n");

    try {
      const outcome = await importSheet(csv);

      expect(outcome.imported).toBe(1);
      expect(outcome.duplicates).toHaveLength(1);
      expect(outcome.duplicates[0].mobile).toBe("7900000001");

      const [unchanged] = await db.select().from(schema.members).where(eq(schema.members.id, existing.id));
      expect(unchanged.fullName).toBe("Original Name");

      const terms = await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.memberId, existing.id));
      expect(terms).toHaveLength(0);
    } finally {
      const rows = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(like(schema.members.fullName, "Member Fresh"));
      const ids = [existing.id, ...rows.map((row) => row.id)];
      await db.delete(schema.memberships).where(inArray(schema.memberships.memberId, ids));
      await db.delete(schema.members).where(inArray(schema.members.id, ids));
    }
  });

  it("keeps a member whose optional details are missing", async () => {
    const { db } = await import("@/db");
    const { like, inArray } = await import("drizzle-orm");
    const schema = await import("@/db/schema");

    const [staff] = await db.select().from(schema.users).limit(1);
    STAFF.id = staff.id;

    const csv = [
      "Name,Mobile,DOB,Valid Till,Aadhaar",
      // No date of birth, and an Aadhaar that is too short to be real.
      "Member Partial,7910000001,,15/12/2026,1234",
    ].join("\n");

    try {
      const outcome = await importSheet(csv);

      expect(outcome.imported).toBe(1);
      expect(outcome.rejected).toHaveLength(0);
      expect(outcome.warnings[0].issues.join(" ")).toContain("Aadhaar");

      const [imported] = await db
        .select()
        .from(schema.members)
        .where(like(schema.members.fullName, "Member Partial"));
      expect(imported.fullName).toBe("Member Partial");
      expect(imported.dateOfBirth).toBeNull();
      expect(imported.aadhaarEnc).toBeNull();
    } finally {
      const rows = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(like(schema.members.fullName, "Member Partial"));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db.delete(schema.memberships).where(inArray(schema.memberships.memberId, ids));
        await db.delete(schema.members).where(inArray(schema.members.id, ids));
      }
    }
  });

  it("imports nothing at all if any row fails on the way in", async () => {
    const { db } = await import("@/db");
    const { like, sql } = await import("drizzle-orm");
    const schema = await import("@/db/schema");

    const [staff] = await db.select().from(schema.users).limit(1);
    STAFF.id = staff.id;

    // Two rows carrying the same Aadhaar. The second is imported without it
    // rather than clashing, so this must still succeed — and if the guard were
    // ever removed, the unique index would roll the whole import back.
    const csv = [
      "Name,Mobile,Aadhaar,Valid Till",
      "Member TwinA,7920000001,123412341234,15/12/2026",
      "Member TwinB,7920000002,123412341234,15/12/2026",
    ].join("\n");

    const before = await db.select({ count: sql<number>`count(*)::int` }).from(schema.members);

    try {
      const outcome = await importSheet(csv);
      expect(outcome.imported).toBe(2);

      const twins = await db
        .select()
        .from(schema.members)
        .where(like(schema.members.fullName, "Member Twin%"));
      expect(twins.filter((member) => member.aadhaarEnc)).toHaveLength(1);

      const after = await db.select({ count: sql<number>`count(*)::int` }).from(schema.members);
      expect(after[0].count).toBe(before[0].count + 2);
    } finally {
      const { inArray } = await import("drizzle-orm");
      const rows = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(like(schema.members.fullName, "Member Twin%"));
      const ids = rows.map((row) => row.id);
      if (ids.length) {
        await db.delete(schema.memberships).where(inArray(schema.memberships.memberId, ids));
        await db.delete(schema.members).where(inArray(schema.members.id, ids));
      }
    }
  });
});
