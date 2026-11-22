/**
 * Development seed.
 *
 * Creates the accounts, station categories, stations, price list, menu and a
 * couple of demo members needed to explore the app. Everything it writes is
 * clearly marked DEMO in its description/notes so it is obvious what to delete
 * before going live.
 *
 *   npm run db:seed              # configuration + demo catalogue
 *   npm run db:seed -- --history # also generates ~14 days of fake sales
 *
 * It is safe to run more than once: existing rows are matched by their natural
 * key and left alone.
 */
import "./load-env";

import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildPoolConfig } from "../src/db/pool-config";
import * as schema from "../src/db/schema";

const {
  businessSettings,
  foodCategories,
  foodItems,
  foodOrderItems,
  foodOrders,
  gameSessions,
  members,
  memberships,
  payments,
  pricingRules,
  stationCategories,
  stations,
  transactions,
  users,
} = schema;

const withHistory = process.argv.includes("--history");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Create .env.local in the project folder (copy .env.example) and\n" +
      "add your database connection string before running the seed.",
  );
}

const pool = new Pool(buildPoolConfig(connectionString, { max: 1 }));
const db = drizzle(pool, { schema, casing: "snake_case" });

const rupees = (value: number) => Math.round(value * 100);

async function main() {
  console.log("Seeding Dr. Games…");

  /* ------------------------------- Settings ------------------------------- */
  await db
    .insert(businessSettings)
    .values({
      id: 1,
      cafeName: "Dr. Games",
      currencySymbol: "EGP",
      invoicePrefix: "DG",
      address: "2nd Floor, MG Road, Bengaluru 560001",
      phone: "+91 98765 43210",
      nightStart: "23:00",
      nightEnd: "06:00",
      dayPassEnabled: true,
      dayPassMinutes: 720,
      membershipDays: 365,
      membershipPrice: rupees(1000),
      timezone: "Asia/Kolkata",
    })
    .onConflictDoNothing();

  /* -------------------------------- Users --------------------------------- */
  const accounts = [
    {
      email: process.env.SEED_ADMIN_EMAIL ?? "admin@genzcafe.local",
      password: process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345",
      name: "Cafe Owner",
      role: "ADMIN" as const,
      canDiscount: true,
      maxDiscountPercent: 100,
      canViewSensitive: true,
    },
    {
      email: "manager@genzcafe.local",
      password: "Manager@12345",
      name: "Floor Manager",
      role: "MANAGER" as const,
      canDiscount: true,
      maxDiscountPercent: 25,
      canViewSensitive: false,
    },
    {
      email: "staff@genzcafe.local",
      password: "Staff@12345",
      name: "Counter Staff",
      role: "STAFF" as const,
      canDiscount: false,
      maxDiscountPercent: 0,
      canViewSensitive: false,
    },
  ];

  const userIds: Record<string, string> = {};
  for (const account of accounts) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${account.email.toLowerCase()}`)
      .limit(1);
    if (existing) {
      userIds[account.role] = existing.id;
      continue;
    }
    const [created] = await db
      .insert(users)
      .values({
        email: account.email,
        name: account.name,
        passwordHash: await bcrypt.hash(account.password, 12),
        role: account.role,
        canDiscount: account.canDiscount,
        maxDiscountPercent: account.maxDiscountPercent,
        canViewSensitive: account.canViewSensitive,
      })
      .returning({ id: users.id });
    userIds[account.role] = created.id;
    console.log(`  user   ${account.email} (${account.role}) — password: ${account.password}`);
  }

  /* ------------------------- Station categories --------------------------- */
  // `maxPlayers` is how many people can share one station of this category.
  // Anything above 1 turns on the player picker at the counter, and each
  // player is then charged their own member or regular rate.
  const categorySpec = [
    { name: "Gaming PC", color: "#F5C518", maxPlayers: 1, sortOrder: 1, description: "DEMO · RTX gaming rigs" },
    { name: "PS5 Single Player", color: "#3B82F6", maxPlayers: 1, sortOrder: 2, description: "DEMO · one controller" },
    { name: "PS5 Multiplayer", color: "#8B5CF6", maxPlayers: 4, sortOrder: 3, description: "DEMO · up to four controllers" },
    { name: "F1 Simulator", color: "#EF4444", maxPlayers: 1, sortOrder: 4, description: "DEMO · racing rig" },
    { name: "VR Simulator", color: "#22C55E", maxPlayers: 2, sortOrder: 5, description: "DEMO · headset + tracked space" },
  ];

  const categoryIds: Record<string, string> = {};
  for (const category of categorySpec) {
    const [existing] = await db
      .select({ id: stationCategories.id })
      .from(stationCategories)
      .where(sql`lower(${stationCategories.name}) = ${category.name.toLowerCase()}`)
      .limit(1);
    if (existing) {
      categoryIds[category.name] = existing.id;
      continue;
    }
    const [created] = await db.insert(stationCategories).values(category).returning({ id: stationCategories.id });
    categoryIds[category.name] = created.id;
  }
  console.log(`  categories: ${Object.keys(categoryIds).length}`);

  /* -------------------------------- Stations ------------------------------ */
  const stationSpec = [
    { code: "PC-01", name: "Gaming PC 1", category: "Gaming PC", color: "#F5C518" },
    { code: "PC-02", name: "Gaming PC 2", category: "Gaming PC", color: "#F5C518" },
    { code: "PC-03", name: "Gaming PC 3", category: "Gaming PC", color: "#F5C518" },
    { code: "PC-04", name: "Gaming PC 4", category: "Gaming PC", color: "#F5C518" },
    { code: "PC-05", name: "Gaming PC 5", category: "Gaming PC", color: "#F5C518" },
    { code: "PS5-01", name: "PS5 Station 1", category: "PS5 Single Player", color: "#3B82F6" },
    { code: "PS5-02", name: "PS5 Station 2", category: "PS5 Multiplayer", color: "#8B5CF6" },
    { code: "F1-01", name: "F1 Racing Rig", category: "F1 Simulator", color: "#EF4444" },
    { code: "VR-01", name: "VR Arena", category: "VR Simulator", color: "#22C55E" },
  ];

  const stationIds: Record<string, string> = {};
  for (const [index, station] of stationSpec.entries()) {
    const [existing] = await db
      .select({ id: stations.id })
      .from(stations)
      .where(sql`upper(${stations.code}) = ${station.code}`)
      .limit(1);
    if (existing) {
      stationIds[station.code] = existing.id;
      continue;
    }
    const [created] = await db
      .insert(stations)
      .values({
        code: station.code,
        name: station.name,
        categoryId: categoryIds[station.category],
        color: station.color,
        description: "DEMO station created by the seed script",
        sortOrder: index,
      })
      .returning({ id: stations.id });
    stationIds[station.code] = created.id;
  }
  console.log(`  stations: ${Object.keys(stationIds).length}`);

  /* -------------------------------- Pricing ------------------------------- */
  // [minutes, regular normal, member normal, regular night, member night]
  const priceTable: Record<string, [number, number, number, number, number][]> = {
    "Gaming PC": [
      [30, 60, 50, 80, 70],
      [60, 100, 80, 140, 120],
      [120, 180, 150, 260, 220],
      [180, 250, 210, 360, 310],
      [240, 320, 270, 460, 400],
      [300, 380, 320, 560, 480],
      [360, 440, 370, 640, 560],
      [480, 550, 470, 820, 720],
    ],
    "PS5 Single Player": [
      [30, 70, 60, 90, 80],
      [60, 120, 100, 160, 140],
      [120, 220, 180, 300, 260],
      [180, 300, 250, 420, 370],
      [240, 380, 320, 540, 470],
    ],
    "PS5 Multiplayer": [
      [30, 100, 85, 130, 110],
      [60, 180, 150, 230, 200],
      [120, 320, 270, 420, 370],
      [180, 450, 380, 600, 520],
    ],
    "F1 Simulator": [
      [15, 150, 130, 180, 160],
      [30, 280, 240, 340, 300],
      [60, 500, 430, 620, 540],
      [180, 1300, 1150, 1600, 1400],
    ],
    "VR Simulator": [
      [15, 200, 170, 240, 210],
      [30, 350, 300, 420, 370],
      [60, 600, 520, 720, 640],
    ],
  };

  let ruleCount = 0;
  for (const [categoryName, rows] of Object.entries(priceTable)) {
    const categoryId = categoryIds[categoryName];
    for (const [minutes, regularNormal, memberNormal, regularNight, memberNight] of rows) {
      const variants = [
        { customerType: "REGULAR" as const, timeBand: "NORMAL" as const, price: regularNormal },
        { customerType: "MEMBER" as const, timeBand: "NORMAL" as const, price: memberNormal },
        { customerType: "REGULAR" as const, timeBand: "NIGHT" as const, price: regularNight },
        { customerType: "MEMBER" as const, timeBand: "NIGHT" as const, price: memberNight },
      ];
      for (const variant of variants) {
        await db
          .insert(pricingRules)
          .values({
            categoryId,
            customerType: variant.customerType,
            timeBand: variant.timeBand,
            kind: "SLAB",
            durationMinutes: minutes,
            price: rupees(variant.price),
          })
          .onConflictDoNothing();
        ruleCount += 1;
      }
    }
  }

  // Day passes for the two most-used categories.
  for (const [categoryName, regular, member] of [
    ["Gaming PC", 700, 600],
    ["PS5 Single Player", 850, 720],
  ] as const) {
    for (const [customerType, price] of [
      ["REGULAR", regular],
      ["MEMBER", member],
    ] as const) {
      await db
        .insert(pricingRules)
        .values({
          categoryId: categoryIds[categoryName],
          customerType,
          timeBand: "NORMAL",
          kind: "DAY_PASS",
          durationMinutes: 720,
          price: rupees(price),
        })
        .onConflictDoNothing();
    }
  }
  console.log(`  pricing rules: ${ruleCount} slabs + day passes`);

  /* --------------------------------- Food --------------------------------- */
  // [name, price, description, member price (optional)]
  const menuSpec: Record<string, [string, number, string, number?][]> = {
    Snacks: [
      ["French Fries", 100, "DEMO · salted, crispy"],
      ["Chicken Wings", 180, "DEMO · 6 pieces"],
      ["Nachos", 140, "DEMO · with salsa"],
    ],
    "Fast Food": [
      ["Burger", 150, "DEMO · chicken or veg", 130],
      ["Chicken Roll", 130, "DEMO"],
      ["Maggi", 70, "DEMO · classic gamer fuel"],
    ],
    Drinks: [
      ["Coke", 60, "DEMO · 300ml", 50],
      ["Cold Coffee", 90, "DEMO", 75],
      ["Energy Drink", 120, "DEMO", 100],
      ["Water Bottle", 20, "DEMO · 1L"],
    ],
    Combos: [["Burger + Fries + Coke", 280, "DEMO · saver combo", 240]],
  };

  const foodIds: { id: string; price: number; name: string; taxPercent: number }[] = [];
  let sortOrder = 0;
  for (const [categoryName, items] of Object.entries(menuSpec)) {
    let [category] = await db
      .select({ id: foodCategories.id })
      .from(foodCategories)
      .where(sql`lower(${foodCategories.name}) = ${categoryName.toLowerCase()}`)
      .limit(1);
    if (!category) {
      [category] = await db
        .insert(foodCategories)
        .values({ name: categoryName, sortOrder: sortOrder++ })
        .returning({ id: foodCategories.id });
    }
    // The optional fourth value is the member price for that item.
    for (const [name, price, description, memberPrice] of items) {
      const [existing] = await db
        .select({ id: foodItems.id, price: foodItems.price, taxPercent: foodItems.taxPercent })
        .from(foodItems)
        .where(and(eq(foodItems.categoryId, category.id), sql`lower(${foodItems.name}) = ${name.toLowerCase()}`))
        .limit(1);
      if (existing) {
        foodIds.push({ id: existing.id, price: existing.price, name, taxPercent: existing.taxPercent });
        continue;
      }
      const [created] = await db
        .insert(foodItems)
        .values({
          name,
          categoryId: category.id,
          price: rupees(price),
          memberPrice: typeof memberPrice === "number" ? rupees(memberPrice) : null,
          description,
        })
        .returning({ id: foodItems.id, price: foodItems.price, taxPercent: foodItems.taxPercent });
      foodIds.push({ id: created.id, price: created.price, name, taxPercent: created.taxPercent });
    }
  }
  console.log(`  menu items: ${foodIds.length}`);

  /* -------------------------------- Members ------------------------------- */
  const memberSpec = [
    { name: "Arjun Rao", mobile: "9876543210", daysLeft: 300 },
    { name: "Priya Nair", mobile: "9876543211", daysLeft: 12 },
    { name: "Rahul Kumar", mobile: "9876543212", daysLeft: -20 },
  ];

  const memberRows: { id: string; membershipId: string | null; endDate: Date }[] = [];
  for (const [index, spec] of memberSpec.entries()) {
    let [member] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.mobile, spec.mobile))
      .limit(1);
    if (!member) {
      [member] = await db
        .insert(members)
        .values({
          memberCode: `GZM-${String(index + 1).padStart(5, "0")}`,
          fullName: spec.name,
          mobile: spec.mobile,
          notes: "DEMO member created by the seed script",
        })
        .returning({ id: members.id });
    }

    const [existingMembership] = await db
      .select({ id: memberships.id, endDate: memberships.endDate })
      .from(memberships)
      .where(eq(memberships.memberId, member.id))
      .limit(1);

    if (existingMembership) {
      memberRows.push({ id: member.id, membershipId: existingMembership.id, endDate: existingMembership.endDate });
      continue;
    }

    const endDate = new Date(Date.now() + spec.daysLeft * 86_400_000);
    const startDate = new Date(endDate.getTime() - 365 * 86_400_000);
    const [membership] = await db
      .insert(memberships)
      .values({
        memberId: member.id,
        startDate,
        endDate,
        price: rupees(1000),
        note: "DEMO membership",
        createdById: userIds.ADMIN,
      })
      .returning({ id: memberships.id });
    memberRows.push({ id: member.id, membershipId: membership.id, endDate });
  }
  console.log(`  members: ${memberRows.length}`);

  /* ------------------------------- History -------------------------------- */
  if (withHistory) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(transactions);
    if (count > 0) {
      console.log("  history: skipped (transactions already exist)");
    } else {
      await seedHistory(stationIds, categoryIds, foodIds, memberRows, userIds);
    }
  }

  console.log("\nSeed complete.");
  console.log("Sign in with:");
  for (const account of accounts) console.log(`  ${account.email}  /  ${account.password}`);
  console.log("\nDemo rows are labelled DEMO — delete them before going live.");
}

/** Fabricates two weeks of completed sales so the dashboards have shape. */
async function seedHistory(
  stationIds: Record<string, string>,
  categoryIds: Record<string, string>,
  foodIds: { id: string; price: number; name: string; taxPercent: number }[],
  memberRows: { id: string; membershipId: string | null; endDate: Date }[],
  userIds: Record<string, string>,
) {
  const stationList = Object.entries(stationIds);
  const categoryByStation = new Map<string, string>();
  for (const [code, id] of stationList) {
    const categoryName = code.startsWith("PC")
      ? "Gaming PC"
      : code.startsWith("PS5-01")
        ? "PS5 Single Player"
        : code.startsWith("PS5")
          ? "PS5 Multiplayer"
          : code.startsWith("F1")
            ? "F1 Simulator"
            : "VR Simulator";
    categoryByStation.set(id, categoryName);
  }

  // Deterministic pseudo-random so repeated seeds look the same.
  let seedValue = 42;
  const random = () => {
    seedValue = (seedValue * 1103515245 + 12345) % 2147483648;
    return seedValue / 2147483648;
  };

  let invoice = 0;
  let created = 0;

  for (let daysAgo = 13; daysAgo >= 0; daysAgo -= 1) {
    const sessionsToday = 6 + Math.floor(random() * 10);
    for (let index = 0; index < sessionsToday; index += 1) {
      const [stationCode, stationId] = stationList[Math.floor(random() * stationList.length)];
      const categoryName = categoryByStation.get(stationId) ?? "Gaming PC";

      const startHour = 11 + Math.floor(random() * 11);
      const startedAt = new Date();
      startedAt.setDate(startedAt.getDate() - daysAgo);
      startedAt.setHours(startHour, Math.floor(random() * 60), 0, 0);

      const minutes = [30, 60, 60, 90, 120, 180][Math.floor(random() * 6)];
      const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
      if (endedAt.getTime() > Date.now()) continue;

      const isMember = random() < 0.3;
      const member = isMember ? memberRows[Math.floor(random() * memberRows.length)] : null;

      const [rule] = await db
        .select({ price: pricingRules.price })
        .from(pricingRules)
        .where(
          and(
            eq(pricingRules.categoryId, categoryIds[categoryName]),
            eq(pricingRules.customerType, member ? "MEMBER" : "REGULAR"),
            eq(pricingRules.timeBand, "NORMAL"),
            eq(pricingRules.kind, "SLAB"),
            eq(pricingRules.durationMinutes, minutes),
          ),
        )
        .limit(1);

      const gamingAmount = rule?.price ?? rupees(100);

      const sessionId = randomUUID();
      await db.insert(gameSessions).values({
        id: sessionId,
        code: `S-DEMO-${String(created).padStart(5, "0")}`,
        stationId,
        memberId: member?.id ?? null,
        membershipId: member?.membershipId ?? null,
        customerName: member ? null : ["Walk-in", "Sameer", "Nikhil", "Ananya", "Zoya"][Math.floor(random() * 5)],
        customerType: member ? "MEMBER" : "REGULAR",
        status: "COMPLETED",
        startedAt,
        endedAt,
        notes: "DEMO session generated by the seed script",
        startedById: userIds.STAFF,
        endedById: userIds.STAFF,
      });

      // Roughly half of the sessions order food.
      let foodAmount = 0;
      if (random() < 0.5) {
        const orderId = randomUUID();
        await db.insert(foodOrders).values({
          id: orderId,
          code: `F-DEMO-${String(created).padStart(5, "0")}`,
          sessionId,
          status: "SERVED",
          createdById: userIds.STAFF,
          createdAt: new Date(startedAt.getTime() + 15 * 60_000),
        });
        const lineCount = 1 + Math.floor(random() * 2);
        for (let line = 0; line < lineCount; line += 1) {
          const item = foodIds[Math.floor(random() * foodIds.length)];
          const quantity = 1 + Math.floor(random() * 2);
          const lineTotal = item.price * quantity;
          foodAmount += lineTotal;
          await db.insert(foodOrderItems).values({
            orderId,
            foodItemId: item.id,
            nameSnapshot: item.name,
            unitPrice: item.price,
            taxPercent: item.taxPercent,
            quantity,
            lineTotal,
            taxAmount: 0,
          });
        }
      }

      const subtotal = gamingAmount + foodAmount;
      const method = random() < 0.45 ? "CASH" : random() < 0.85 ? "UPI" : "SPLIT";
      const cashAmount = method === "CASH" ? subtotal : method === "SPLIT" ? Math.round(subtotal / 2) : 0;
      const upiAmount = subtotal - cashAmount;

      invoice += 1;
      const transactionId = randomUUID();
      await db.insert(transactions).values({
        id: transactionId,
        code: `GZ-DEMO-${String(invoice).padStart(6, "0")}`,
        sessionId,
        stationId,
        stationSnapshot: `${stationCode} — demo`,
        categorySnapshot: categoryName,
        memberId: member?.id ?? null,
        customerType: member ? "MEMBER" : "REGULAR",
        startedAt,
        endedAt,
        durationMinutes: minutes,
        billedMinutes: minutes,
        gamingAmount,
        foodAmount,
        subtotal,
        totalAmount: subtotal,
        paymentMethod: method,
        cashAmount,
        upiAmount,
        staffId: userIds.STAFF,
        createdAt: endedAt,
        updatedAt: endedAt,
      });

      if (cashAmount > 0) {
        await db.insert(payments).values({ transactionId, channel: "CASH", amount: cashAmount, createdAt: endedAt });
      }
      if (upiAmount > 0) {
        await db.insert(payments).values({ transactionId, channel: "UPI", amount: upiAmount, createdAt: endedAt });
      }
      created += 1;
    }
  }

  await db.update(businessSettings).set({ invoiceCounter: invoice }).where(eq(businessSettings.id, 1));
  console.log(`  demo history: ${created} completed sessions across 14 days`);
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await pool.end();
    process.exit(1);
  });
