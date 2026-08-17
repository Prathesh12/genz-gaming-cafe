import { afterAll, describe, expect, it } from "vitest";

/**
 * Which membership term applies *right now*.
 *
 * A renewal bought before the current term runs out is stacked on top of it, so
 * the newest row starts in the future. Picking "the membership with the latest
 * end date" therefore picks a term that has not begun — and the member gets
 * charged regular rates while the search dialog, which reads the same latest
 * row, still shows them as active. That mismatch is what these tests pin down.
 *
 * Runs against a real seeded database; skips itself when DATABASE_URL is unset.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

let pool: { end: () => Promise<void> } | undefined;

afterAll(async () => {
  await pool?.end();
});

const DAY = 86_400_000;

/** A station with nothing running on it, so the test never fights live data. */
async function pickFreeStation(categoryId?: string) {
  const { db } = await import("@/db");
  const { and, eq, inArray, notInArray, sql } = await import("drizzle-orm");
  const schema = await import("@/db/schema");

  const busy = await db
    .select({ stationId: schema.gameSessions.stationId })
    .from(schema.gameSessions)
    .where(inArray(schema.gameSessions.status, ["ACTIVE", "PAUSED"]));
  const busyIds = busy.map((row) => row.stationId);

  const [station] = await db
    .select()
    .from(schema.stations)
    .where(
      and(
        eq(schema.stations.isActive, true),
        categoryId ? eq(schema.stations.categoryId, categoryId) : sql`true`,
        busyIds.length ? notInArray(schema.stations.id, busyIds) : sql`true`,
      ),
    )
    .limit(1);

  if (!station) throw new Error("No free station to test with — end any live sessions first.");
  return station;
}

describeIfDb("the membership that applies right now", () => {
  it("charges member rates to someone who renewed before their term ran out", async () => {
    const { db, pool: dbPool } = await import("@/db");
    pool = dbPool;
    const { eq } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    const { startSession } = await import("@/server/services/sessions");

    const [staff] = await db.select().from(schema.users).limit(1);
    expect(staff, "seed the database first: npm run db:seed").toBeDefined();
    const station = await pickFreeStation();

    const stamp = Date.now();
    const [member] = await db
      .insert(schema.members)
      .values({
        memberCode: `TST-${stamp}`,
        fullName: `Renewal Test ${stamp}`,
        mobile: String(9_700_000_000 + (stamp % 1_000_000)),
      })
      .returning();

    // The term they are inside right now…
    const currentEnd = new Date(stamp + 20 * DAY);
    await db.insert(schema.memberships).values({
      memberId: member.id,
      startDate: new Date(stamp - 10 * DAY),
      endDate: currentEnd,
      price: 9900,
    });
    // …and the renewal they bought early, which stacks on top and so has both
    // the latest end date *and* a start date in the future.
    const renewalEnd = new Date(currentEnd.getTime() + 365 * DAY);
    await db.insert(schema.memberships).values({
      memberId: member.id,
      startDate: currentEnd,
      endDate: renewalEnd,
      price: 9900,
    });

    const user = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      canDiscount: true,
      maxDiscountPercent: 100,
      canViewSensitive: true,
    };

    let sessionId: string | undefined;
    try {
      const session = await startSession(
        {
          stationId: station.id,
          customerName: null,
          customerMobile: null,
          memberId: member.id,
          plannedMinutes: null,
          notes: null,
          reservationId: null,
        },
        user,
      );
      sessionId = session.id;

      // The bug: this came back REGULAR, so a paid-up member was charged full
      // price while the picker showed them in green as an active member.
      expect(session.customerType).toBe("MEMBER");

      const [seat] = await db
        .select()
        .from(schema.sessionPlayers)
        .where(eq(schema.sessionPlayers.sessionId, session.id));
      expect(seat.customerType).toBe("MEMBER");
      // Cover runs to the end of the stacked renewal, not just the term they
      // happen to be inside — a session running past midnight on the changeover
      // day must not flip to regular rates halfway through.
      expect(seat.membershipValidUntil?.toISOString()).toBe(renewalEnd.toISOString());
    } finally {
      if (sessionId) {
        await db.delete(schema.gameSessions).where(eq(schema.gameSessions.id, sessionId));
        await db
          .update(schema.stations)
          .set({ status: "AVAILABLE" })
          .where(eq(schema.stations.id, station.id));
      }
      await db.delete(schema.memberships).where(eq(schema.memberships.memberId, member.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    }
  });

  it("keeps every member on member rates when several share a station", async () => {
    const { db, pool: dbPool } = await import("@/db");
    pool = dbPool;
    const { eq, asc } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    const { startSession } = await import("@/server/services/sessions");

    const [staff] = await db.select().from(schema.users).limit(1);
    const [category] = await db
      .select()
      .from(schema.stationCategories)
      .where(eq(schema.stationCategories.maxPlayers, 4))
      .limit(1);
    expect(category, "seed the database first: npm run db:seed").toBeDefined();
    const station = await pickFreeStation(category.id);

    const stamp = Date.now();
    const created: string[] = [];

    // Two paid-up members: one on a straightforward term, one who renewed early.
    for (const [index, renewsEarly] of [false, true].entries()) {
      const [member] = await db
        .insert(schema.members)
        .values({
          memberCode: `TSTM-${stamp}-${index}`,
          fullName: `Group Member ${stamp}-${index}`,
          mobile: String(9_800_000_000 + (stamp % 1_000_000) + index),
        })
        .returning();
      created.push(member.id);

      const currentEnd = new Date(stamp + 30 * DAY);
      await db.insert(schema.memberships).values({
        memberId: member.id,
        startDate: new Date(stamp - 5 * DAY),
        endDate: currentEnd,
        price: 9900,
      });
      if (renewsEarly) {
        await db.insert(schema.memberships).values({
          memberId: member.id,
          startDate: currentEnd,
          endDate: new Date(currentEnd.getTime() + 365 * DAY),
          price: 9900,
        });
      }
    }

    const user = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      canDiscount: true,
      maxDiscountPercent: 100,
      canViewSensitive: true,
    };

    let sessionId: string | undefined;
    try {
      const session = await startSession(
        {
          stationId: station.id,
          customerName: null,
          customerMobile: null,
          memberId: null,
          plannedMinutes: null,
          notes: null,
          reservationId: null,
          players: [
            { memberId: created[0], name: null },
            { memberId: created[1], name: null },
            { memberId: null, name: null },
            { memberId: null, name: null },
          ],
        },
        user,
      );
      sessionId = session.id;

      const seats = await db
        .select()
        .from(schema.sessionPlayers)
        .where(eq(schema.sessionPlayers.sessionId, session.id))
        .orderBy(asc(schema.sessionPlayers.slot));

      expect(seats).toHaveLength(4);
      // Both members pay member rates — including the one who renewed early.
      expect(seats.map((seat) => seat.customerType)).toEqual(["MEMBER", "MEMBER", "REGULAR", "REGULAR"]);
      expect(session.playerCount).toBe(4);
    } finally {
      if (sessionId) {
        await db.delete(schema.gameSessions).where(eq(schema.gameSessions.id, sessionId));
        await db
          .update(schema.stations)
          .set({ status: "AVAILABLE" })
          .where(eq(schema.stations.id, station.id));
      }
      for (const memberId of created) {
        await db.delete(schema.memberships).where(eq(schema.memberships.memberId, memberId));
        await db.delete(schema.members).where(eq(schema.members.id, memberId));
      }
    }
  });
});
