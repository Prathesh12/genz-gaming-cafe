import "server-only";

import { and, asc, desc, eq, gt, ilike, inArray, lte, or, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import { members, memberships, sessionPlayers, transactions } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { memberCode } from "@/lib/codes";
import { blindIndex, decryptSensitive, encryptSensitive, maskAadhaar } from "@/lib/crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { activeCoverage, type MembershipTerm } from "@/lib/memberships";
import { can } from "@/lib/permissions";
import { fromDateKey } from "@/lib/time";
import { getSettingsFor } from "@/server/services/settings";

export type MemberListRow = {
  id: string;
  memberCode: string;
  fullName: string;
  mobile: string;
  dateOfBirth: string | null;
  aadhaarMasked: string;
  hasAadhaar: boolean;
  isActive: boolean;
  membershipStart: Date | null;
  membershipEnd: Date | null;
  membershipStatus: "ACTIVE" | "EXPIRING" | "EXPIRED" | "NONE";
  daysRemaining: number | null;
  createdAt: Date;
};

function membershipStatusOf(
  end: Date | null,
  warningDays: number,
): { status: MemberListRow["membershipStatus"]; daysRemaining: number | null } {
  if (!end) return { status: "NONE", daysRemaining: null };
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { status: "EXPIRED", daysRemaining: days };
  if (days <= warningDays) return { status: "EXPIRING", daysRemaining: days };
  return { status: "ACTIVE", daysRemaining: days };
}

/**
 * Member list. The Aadhaar number is NEVER selected here — only the masked
 * last four digits, which is all any list view needs.
 */
export async function listMembers(
  options: { search?: string; status?: "ALL" | "ACTIVE" | "EXPIRING" | "EXPIRED"; limit?: number } = {},
  client: DbClient = db,
): Promise<MemberListRow[]> {
  const settings = await getSettingsFor(client);
  const search = options.search?.trim();

  // Latest membership per member.
  const latest = client
    .select({
      memberId: memberships.memberId,
      startDate: sql<Date>`max(${memberships.startDate})`.as("start_date"),
      endDate: sql<Date>`max(${memberships.endDate})`.as("end_date"),
    })
    .from(memberships)
    .groupBy(memberships.memberId)
    .as("latest");

  const rows = await client
    .select({
      id: members.id,
      memberCode: members.memberCode,
      fullName: members.fullName,
      mobile: members.mobile,
      dateOfBirth: members.dateOfBirth,
      aadhaarLast4: members.aadhaarLast4,
      isActive: members.isActive,
      createdAt: members.createdAt,
      membershipStart: latest.startDate,
      membershipEnd: latest.endDate,
    })
    .from(members)
    .leftJoin(latest, eq(latest.memberId, members.id))
    .where(
      search
        ? or(
            ilike(members.fullName, `%${search}%`),
            ilike(members.mobile, `%${search}%`),
            ilike(members.memberCode, `%${search}%`),
          )
        : sql`true`,
    )
    .orderBy(desc(members.createdAt))
    .limit(options.limit ?? 500);

  const ids = rows.map((row) => row.id);
  const terms = ids.length
    ? await client
        .select({
          id: memberships.id,
          memberId: memberships.memberId,
          startDate: memberships.startDate,
          endDate: memberships.endDate,
        })
        .from(memberships)
        .where(inArray(memberships.memberId, ids))
    : [];

  const termsByMember = new Map<string, MembershipTerm[]>();
  for (const row of terms) {
    const list = termsByMember.get(row.memberId) ?? [];
    list.push({ id: row.id, startDate: row.startDate, endDate: row.endDate });
    termsByMember.set(row.memberId, list);
  }

  const now = new Date();

  const mapped = rows.map((row) => {
    const end = row.membershipEnd ? new Date(row.membershipEnd) : null;
    // Status follows real cover, so this list, the session picker and the bill
    // can never disagree about who is a member today.
    const coverage = activeCoverage(termsByMember.get(row.id) ?? [], now);
    const { status, daysRemaining } = coverage
      ? membershipStatusOf(coverage.validUntil, settings.membershipExpiryWarningDays)
      : { status: (end ? "EXPIRED" : "NONE") as MemberListRow["membershipStatus"], daysRemaining: null };
    return {
      id: row.id,
      memberCode: row.memberCode,
      fullName: row.fullName,
      mobile: row.mobile,
      dateOfBirth: row.dateOfBirth,
      aadhaarMasked: maskAadhaar(row.aadhaarLast4),
      hasAadhaar: Boolean(row.aadhaarLast4),
      isActive: row.isActive,
      membershipStart: row.membershipStart ? new Date(row.membershipStart) : null,
      membershipEnd: end,
      membershipStatus: status,
      daysRemaining,
      createdAt: row.createdAt,
    };
  });

  if (!options.status || options.status === "ALL") return mapped;
  return mapped.filter((row) => row.membershipStatus === options.status);
}

/** Fast lookup used by the "start session" dialog. */
export async function searchMembers(query: string, client: DbClient = db) {
  const term = query.trim();
  if (term.length < 2) return [];
  const settings = await getSettingsFor(client);

  /**
   * The latest membership per member, as a joined subquery.
   *
   * Deliberately NOT a correlated subquery written with raw `sql`: column
   * references interpolated that way are rendered unqualified, so an inner
   * `members.id` silently binds to `memberships.id`, matches nothing, and makes
   * every member look like they have no membership.
   */
  const latest = client
    .select({
      memberId: memberships.memberId,
      endDate: sql<Date>`max(${memberships.endDate})`.as("end_date"),
    })
    .from(memberships)
    .groupBy(memberships.memberId)
    .as("latest");

  const rows = await client
    .select({
      id: members.id,
      memberCode: members.memberCode,
      fullName: members.fullName,
      mobile: members.mobile,
      endDate: latest.endDate,
    })
    .from(members)
    .leftJoin(latest, eq(latest.memberId, members.id))
    .where(
      and(
        eq(members.isActive, true),
        or(
          ilike(members.fullName, `%${term}%`),
          ilike(members.mobile, `%${term}%`),
          ilike(members.memberCode, `%${term}%`),
        ),
      ),
    )
    .orderBy(asc(members.fullName))
    .limit(8);

  /**
   * Status is worked out from the terms themselves, using exactly the rule the
   * till uses when it prices the session. Reading only the latest end date is
   * not enough: a term dated to start next month would show as active here and
   * then be charged regular rates, and the counter would have no idea why.
   */
  const ids = rows.map((row) => row.id);
  const terms = ids.length
    ? await client
        .select({
          id: memberships.id,
          memberId: memberships.memberId,
          startDate: memberships.startDate,
          endDate: memberships.endDate,
        })
        .from(memberships)
        .where(inArray(memberships.memberId, ids))
    : [];

  const termsByMember = new Map<string, MembershipTerm[]>();
  for (const row of terms) {
    const list = termsByMember.get(row.memberId) ?? [];
    list.push({ id: row.id, startDate: row.startDate, endDate: row.endDate });
    termsByMember.set(row.memberId, list);
  }

  const now = new Date();

  return rows.map((row) => {
    const coverage = activeCoverage(termsByMember.get(row.id) ?? [], now);
    const latestEnd = row.endDate ? new Date(row.endDate) : null;
    // Covered → count down to the end of unbroken cover. Not covered → EXPIRED
    // (or NONE), which is exactly what the bill will do.
    const { status, daysRemaining } = coverage
      ? membershipStatusOf(coverage.validUntil, settings.membershipExpiryWarningDays)
      : { status: (latestEnd ? "EXPIRED" : "NONE") as MemberListRow["membershipStatus"], daysRemaining: null };

    return {
      id: row.id,
      memberCode: row.memberCode,
      fullName: row.fullName,
      mobile: row.mobile,
      validUntil: coverage ? coverage.validUntil.toISOString() : (latestEnd?.toISOString() ?? null),
      membershipStatus: status,
      daysRemaining,
    };
  });
}

export async function getMemberDetail(memberId: string) {
  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new NotFoundError("Member not found.");

  const history = await db
    .select()
    .from(memberships)
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(memberships.endDate));

  /**
   * Visits and spend counted from the seats this member actually occupied, not
   * only from bills raised in their name — otherwise someone who plays as the
   * third controller on a shared PS5 would never show a visit. `amount` is the
   * player's own share of that bill, so four people sharing one session are
   * each credited with what they paid rather than all four with the whole
   * total. A single-seat session has one player whose share is the full bill,
   * which is why existing figures are unchanged.
   */
  const [spend] = await db
    .select({
      visits: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${sessionPlayers.amount}), 0)::int`,
    })
    .from(sessionPlayers)
    .innerJoin(transactions, eq(transactions.sessionId, sessionPlayers.sessionId))
    .where(and(eq(sessionPlayers.memberId, memberId), eq(transactions.status, "COMPLETED")));

  const settings = await getSettingsFor(db);
  // Same rule as the till: the term covering right now, followed through any
  // renewals stacked on top of it — not simply the row with the latest end date.
  const coverage = activeCoverage(history, new Date());
  const { status, daysRemaining } = coverage
    ? membershipStatusOf(coverage.validUntil, settings.membershipExpiryWarningDays)
    : { status: (history.length ? "EXPIRED" : "NONE") as MemberListRow["membershipStatus"], daysRemaining: null };

  return {
    member: {
      id: member.id,
      memberCode: member.memberCode,
      fullName: member.fullName,
      mobile: member.mobile,
      dateOfBirth: member.dateOfBirth,
      address: member.address,
      notes: member.notes,
      isActive: member.isActive,
      aadhaarMasked: maskAadhaar(member.aadhaarLast4),
      hasAadhaar: Boolean(member.aadhaarEnc),
      createdAt: member.createdAt,
    },
    memberships: history,
    membershipStatus: status,
    daysRemaining,
    stats: { visits: spend?.visits ?? 0, total: spend?.total ?? 0 },
  };
}

/**
 * Reveal a full Aadhaar number. Admin-only, always audited, and returned only
 * to the caller — it is never cached, logged or written to any other table.
 */
export async function revealAadhaar(memberId: string, user: SessionUser): Promise<string> {
  if (!can(user, "members.viewSensitive")) {
    throw new ForbiddenError("Only an admin with sensitive-data access can view a full Aadhaar number.");
  }
  const [member] = await db
    .select({ aadhaarEnc: members.aadhaarEnc, memberCode: members.memberCode })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw new NotFoundError("Member not found.");
  if (!member.aadhaarEnc) throw new NotFoundError("No Aadhaar number is stored for this member.");

  await recordAudit({
    action: "member.sensitive_viewed",
    userId: user.id,
    userLabel: user.name,
    entityType: "member",
    entityId: memberId,
    metadata: { memberCode: member.memberCode, field: "aadhaar" },
  });

  const plain = decryptSensitive(member.aadhaarEnc);
  return plain.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
}

export type MemberInput = {
  id?: string;
  fullName: string;
  mobile: string;
  dateOfBirth: string | null;
  aadhaar?: string;
  address: string | null;
  notes: string | null;
};

export async function createMember(input: MemberInput, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(members);

    const values: typeof members.$inferInsert = {
      memberCode: memberCode(count + 1),
      fullName: input.fullName,
      mobile: input.mobile,
      dateOfBirth: input.dateOfBirth,
      address: input.address,
      notes: input.notes,
    };

    if (input.aadhaar) {
      values.aadhaarEnc = encryptSensitive(input.aadhaar);
      values.aadhaarLast4 = input.aadhaar.slice(-4);
      values.aadhaarHash = blindIndex(input.aadhaar);
    }

    const [member] = await tx.insert(members).values(values).returning();

    await recordAudit(
      {
        action: "member.created",
        userId: user.id,
        userLabel: user.name,
        entityType: "member",
        entityId: member.id,
        // Deliberately no Aadhaar, not even the last four digits.
        metadata: { memberCode: member.memberCode, name: member.fullName },
      },
      tx,
    );

    return member;
  });
}

export async function updateMember(input: MemberInput & { id: string }, user: SessionUser) {
  const values: Partial<typeof members.$inferInsert> = {
    fullName: input.fullName,
    mobile: input.mobile,
    dateOfBirth: input.dateOfBirth,
    address: input.address,
    notes: input.notes,
    updatedAt: new Date(),
  };

  if (input.aadhaar) {
    values.aadhaarEnc = encryptSensitive(input.aadhaar);
    values.aadhaarLast4 = input.aadhaar.slice(-4);
    values.aadhaarHash = blindIndex(input.aadhaar);
  }

  const [member] = await db.update(members).set(values).where(eq(members.id, input.id)).returning();
  if (!member) throw new NotFoundError("Member not found.");

  await recordAudit({
    action: "member.updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "member",
    entityId: member.id,
    metadata: { memberCode: member.memberCode, aadhaarChanged: Boolean(input.aadhaar) },
  });

  return member;
}

export async function setMemberActive(memberId: string, isActive: boolean, user: SessionUser) {
  const [member] = await db
    .update(members)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(members.id, memberId))
    .returning();
  if (!member) throw new NotFoundError("Member not found.");
  await recordAudit({
    action: "member.updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "member",
    entityId: memberId,
    metadata: { isActive },
  });
}

/**
 * Add a membership term. Renewals append a new row rather than overwriting the
 * previous one, so the member's history stays intact. A renewal that starts
 * before the current term ends is extended from the existing end date.
 */
export async function addMembership(
  input: { memberId: string; startDate: string; months?: number; price: number; note: string | null },
  user: SessionUser,
) {
  return db.transaction(async (tx) => {
    const settings = await getSettingsFor(tx);
    const [member] = await tx.select().from(members).where(eq(members.id, input.memberId)).limit(1);
    if (!member) throw new NotFoundError("Member not found.");

    const [current] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.memberId, input.memberId), gt(memberships.endDate, new Date())))
      .orderBy(desc(memberships.endDate))
      .limit(1);

    /**
     * Midnight in the *cafe's* timezone, not UTC. Parsing "2026-08-15" as UTC
     * midnight means the term does not begin until 05:30 in India — so a member
     * who signs up at 1am, when the cafe is busiest, would be charged regular
     * rates for the rest of the night.
     */
    const requestedStart = fromDateKey(input.startDate, settings.timezone);
    if (Number.isNaN(requestedStart.getTime())) throw new ConflictError("Invalid start date.");

    // Stack renewals on top of an unexpired term instead of shortening it.
    const startDate = current && current.endDate > requestedStart ? current.endDate : requestedStart;

    const durationDays = input.months ? input.months * 30 : settings.membershipDays;
    const endDate = new Date(startDate.getTime() + durationDays * 86_400_000);

    const [membership] = await tx
      .insert(memberships)
      .values({
        memberId: input.memberId,
        startDate,
        endDate,
        price: input.price,
        note: input.note,
        createdById: user.id,
      })
      .returning();

    await recordAudit(
      {
        action: "membership.renewed",
        userId: user.id,
        userLabel: user.name,
        entityType: "member",
        entityId: input.memberId,
        metadata: {
          memberCode: member.memberCode,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          price: input.price,
          stacked: Boolean(current && current.endDate > requestedStart),
        },
      },
      tx,
    );

    return membership;
  });
}

/** Counts for the dashboard notification strip. */
export async function getMembershipSummary(client: DbClient = db) {
  const settings = await getSettingsFor(client);
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  const inWarning = new Date(now.getTime() + settings.membershipExpiryWarningDays * 86_400_000);

  const latest = client
    .select({
      memberId: memberships.memberId,
      endDate: sql<Date>`max(${memberships.endDate})`.as("end_date"),
    })
    .from(memberships)
    .groupBy(memberships.memberId)
    .as("latest");

  const [row] = await client
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${latest.endDate} > ${now})::int`,
      expired: sql<number>`count(*) filter (where ${latest.endDate} <= ${now})::int`,
      expiring7: sql<number>`count(*) filter (where ${latest.endDate} > ${now} and ${latest.endDate} <= ${in7})::int`,
      expiringWarning: sql<number>`count(*) filter (where ${latest.endDate} > ${now} and ${latest.endDate} <= ${inWarning})::int`,
    })
    .from(latest);

  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    expired: row?.expired ?? 0,
    expiring7: row?.expiring7 ?? 0,
    expiringWarning: row?.expiringWarning ?? 0,
    warningDays: settings.membershipExpiryWarningDays,
  };
}

/** Members whose membership lapses inside the warning window. */
export async function listExpiringMembers(client: DbClient = db) {
  const settings = await getSettingsFor(client);
  const now = new Date();
  const until = new Date(now.getTime() + settings.membershipExpiryWarningDays * 86_400_000);

  const latest = client
    .select({
      memberId: memberships.memberId,
      endDate: sql<Date>`max(${memberships.endDate})`.as("end_date"),
    })
    .from(memberships)
    .groupBy(memberships.memberId)
    .as("latest");

  return client
    .select({
      id: members.id,
      memberCode: members.memberCode,
      fullName: members.fullName,
      mobile: members.mobile,
      endDate: latest.endDate,
    })
    .from(latest)
    .innerJoin(members, eq(members.id, latest.memberId))
    .where(and(gt(latest.endDate, now), lte(latest.endDate, until)))
    .orderBy(asc(latest.endDate))
    .limit(20);
}
