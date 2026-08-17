import { afterAll, describe, expect, it } from "vitest";

/**
 * Member prices on food.
 *
 * The rule the cafe chose: if anyone on the station holds a valid membership,
 * the whole food order is at member prices. These run against a real database
 * because the price is resolved inside the order transaction, from the session
 * roster — not from anything the browser sends.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

let pool: { end: () => Promise<void> } | undefined;

afterAll(async () => {
  await pool?.end();
});

async function scaffold() {
  const { db, pool: dbPool } = await import("@/db");
  pool = dbPool;
  const { and, eq, inArray, notInArray, sql } = await import("drizzle-orm");
  const schema = await import("@/db/schema");

  const [staff] = await db.select().from(schema.users).limit(1);
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
        busyIds.length ? notInArray(schema.stations.id, busyIds) : sql`true`,
      ),
    )
    .limit(1);

  return { db, schema, staff, station };
}

const USER = {
  id: "",
  email: "food@test.local",
  name: "Counter",
  role: "ADMIN" as const,
  canDiscount: true,
  maxDiscountPercent: 100,
  canViewSensitive: true,
};

describeIfDb("food priced for members", () => {
  it("charges the member price when someone on the station is a member", async () => {
    const { db, schema, staff, station } = await scaffold();
    expect(staff, "seed the database first: npm run db:seed").toBeDefined();
    USER.id = staff.id;

    const { eq } = await import("drizzle-orm");
    const { createFoodOrder } = await import("@/server/services/food");
    const { sessionCode } = await import("@/lib/codes");

    // An item with a real member deal on it.
    const [item] = await db
      .insert(schema.foodItems)
      .values({
        name: `Test Cola ${Date.now()}`,
        categoryId: (await db.select().from(schema.foodCategories).limit(1))[0].id,
        price: 10_000,
        memberPrice: 8_000,
      })
      .returning();

    const startedAt = new Date();
    const [memberSession] = await db
      .insert(schema.gameSessions)
      .values({
        code: sessionCode(startedAt),
        stationId: station.id,
        status: "ACTIVE",
        startedAt,
        startedById: staff.id,
        customerType: "MEMBER",
        playerCount: 2,
      })
      .returning();

    // A four-seat table where only the second player is a member.
    await db.insert(schema.sessionPlayers).values([
      { sessionId: memberSession.id, slot: 1, customerType: "REGULAR", name: "Guest" },
      {
        sessionId: memberSession.id,
        slot: 2,
        customerType: "MEMBER",
        name: "Member",
        memberId: (await db.select().from(schema.members).limit(1))[0]?.id ?? null,
      },
    ]);

    try {
      const { order } = await createFoodOrder(
        { sessionId: memberSession.id, notes: null, items: [{ foodItemId: item.id, quantity: 2 }] },
        USER,
      );

      const [line] = await db
        .select()
        .from(schema.foodOrderItems)
        .where(eq(schema.foodOrderItems.orderId, order.id));

      // Member price, and snapshotted onto the line so the bill cannot move.
      expect(line.unitPrice).toBe(8_000);
      expect(line.lineTotal).toBe(16_000);
    } finally {
      await db.delete(schema.gameSessions).where(eq(schema.gameSessions.id, memberSession.id));
      await db.delete(schema.foodItems).where(eq(schema.foodItems.id, item.id));
      await db.update(schema.stations).set({ status: "AVAILABLE" }).where(eq(schema.stations.id, station.id));
    }
  });

  it("charges the ordinary price when nobody on the station is a member", async () => {
    const { db, schema, staff, station } = await scaffold();
    USER.id = staff.id;

    const { eq } = await import("drizzle-orm");
    const { createFoodOrder } = await import("@/server/services/food");
    const { sessionCode } = await import("@/lib/codes");

    const [item] = await db
      .insert(schema.foodItems)
      .values({
        name: `Test Juice ${Date.now()}`,
        categoryId: (await db.select().from(schema.foodCategories).limit(1))[0].id,
        price: 10_000,
        memberPrice: 8_000,
      })
      .returning();

    const startedAt = new Date();
    const [walkIn] = await db
      .insert(schema.gameSessions)
      .values({
        code: sessionCode(startedAt),
        stationId: station.id,
        status: "ACTIVE",
        startedAt,
        startedById: staff.id,
        customerType: "REGULAR",
      })
      .returning();
    await db
      .insert(schema.sessionPlayers)
      .values({ sessionId: walkIn.id, slot: 1, customerType: "REGULAR", name: "Walk-in" });

    try {
      const { order } = await createFoodOrder(
        { sessionId: walkIn.id, notes: null, items: [{ foodItemId: item.id, quantity: 1 }] },
        USER,
      );
      const [line] = await db
        .select()
        .from(schema.foodOrderItems)
        .where(eq(schema.foodOrderItems.orderId, order.id));
      expect(line.unitPrice).toBe(10_000);
    } finally {
      await db.delete(schema.gameSessions).where(eq(schema.gameSessions.id, walkIn.id));
      await db.delete(schema.foodItems).where(eq(schema.foodItems.id, item.id));
      await db.update(schema.stations).set({ status: "AVAILABLE" }).where(eq(schema.stations.id, station.id));
    }
  });

  it("charges the ordinary price for an item with no member deal, even for a member", async () => {
    const { db, schema, staff, station } = await scaffold();
    USER.id = staff.id;

    const { eq } = await import("drizzle-orm");
    const { createFoodOrder } = await import("@/server/services/food");
    const { sessionCode } = await import("@/lib/codes");

    const [item] = await db
      .insert(schema.foodItems)
      .values({
        name: `Test Water ${Date.now()}`,
        categoryId: (await db.select().from(schema.foodCategories).limit(1))[0].id,
        price: 2_000,
        memberPrice: null,
      })
      .returning();

    const startedAt = new Date();
    const [session] = await db
      .insert(schema.gameSessions)
      .values({
        code: sessionCode(startedAt),
        stationId: station.id,
        status: "ACTIVE",
        startedAt,
        startedById: staff.id,
        customerType: "MEMBER",
      })
      .returning();
    await db
      .insert(schema.sessionPlayers)
      .values({ sessionId: session.id, slot: 1, customerType: "REGULAR", name: "Guest" });

    try {
      const { order } = await createFoodOrder(
        { sessionId: session.id, notes: null, items: [{ foodItemId: item.id, quantity: 3 }] },
        USER,
      );
      const [line] = await db
        .select()
        .from(schema.foodOrderItems)
        .where(eq(schema.foodOrderItems.orderId, order.id));
      expect(line.unitPrice).toBe(2_000);
      expect(line.lineTotal).toBe(6_000);
    } finally {
      await db.delete(schema.gameSessions).where(eq(schema.gameSessions.id, session.id));
      await db.delete(schema.foodItems).where(eq(schema.foodItems.id, item.id));
      await db.update(schema.stations).set({ status: "AVAILABLE" }).where(eq(schema.stations.id, station.id));
    }
  });

  it("refuses a member price above the ordinary price", async () => {
    const { db, schema } = await scaffold();
    const [category] = await db.select().from(schema.foodCategories).limit(1);

    // Drizzle wraps the driver error, so the constraint name is on the cause.
    let caught: unknown;
    try {
      await db.insert(schema.foodItems).values({
        name: `Test Bad ${Date.now()}`,
        categoryId: category.id,
        price: 5_000,
        memberPrice: 9_000,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught, "the database must refuse this, whatever the app does").toBeDefined();
    const cause = (caught as { cause?: { constraint?: string } }).cause;
    expect(cause?.constraint).toBe("food_items_member_price_sane");
  });
});

describe("picking the price for an item", () => {
  it("is a pure choice between the two prices", async () => {
    const { foodPriceFor } = await import("@/server/services/food");

    expect(foodPriceFor({ price: 10_000, memberPrice: 8_000 }, true)).toBe(8_000);
    expect(foodPriceFor({ price: 10_000, memberPrice: 8_000 }, false)).toBe(10_000);
    expect(foodPriceFor({ price: 10_000, memberPrice: null }, true)).toBe(10_000);
    // Never charge a member more than the ordinary price, whatever is stored.
    expect(foodPriceFor({ price: 10_000, memberPrice: 12_000 }, true)).toBe(10_000);
  });
});
