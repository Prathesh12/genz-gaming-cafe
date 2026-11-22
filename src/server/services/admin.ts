import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  businessSettings,
  foodCategories,
  foodItems,
  gameSessions,
  pricingRules,
  reservations,
  stationCategories,
  stations,
  transactions,
  users,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { hashPassword, type SessionUser } from "@/lib/auth";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseHHmm } from "@/lib/time";

/* -------------------------------------------------------------------------- */
/* Station categories                                                         */
/* -------------------------------------------------------------------------- */

export async function upsertStationCategory(
  input: {
    id?: string;
    name: string;
    description: string | null;
    color: string;
    maxPlayers: number;
    sortOrder: number;
    playstationType: "PS4" | "PS5" | null;
    pricingModel: "PER_PLAYER" | "ROOM";
  },
  user: SessionUser,
) {
  if (input.id) {
    const [existing] = await db.select().from(stationCategories).where(eq(stationCategories.id, input.id)).limit(1);
    if (!existing) throw new NotFoundError("Room type not found.");
    const billingChanged =
      existing.pricingModel !== input.pricingModel ||
      existing.playstationType !== input.playstationType ||
      existing.maxPlayers !== input.maxPlayers;
    if (billingChanged) {
      const [live] = await db
        .select({ id: gameSessions.id })
        .from(gameSessions)
        .innerJoin(stations, eq(gameSessions.stationId, stations.id))
        .where(and(eq(stations.categoryId, input.id), inArray(gameSessions.status, ["ACTIVE", "PAUSED"])))
        .limit(1);
      if (live) throw new ConflictError("Finish active sessions before changing this room type or capacity.");
    }
    const [row] = await db
      .update(stationCategories)
      .set({
        name: input.name,
        description: input.description,
        color: input.color,
        maxPlayers: input.maxPlayers,
        playstationType: input.playstationType,
        pricingModel: input.pricingModel,
        sortOrder: input.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(stationCategories.id, input.id))
      .returning();
    if (!row) throw new NotFoundError("Category not found.");
    await recordAudit({
      action: "category.updated",
      userId: user.id,
      userLabel: user.name,
      entityType: "station_category",
      entityId: row.id,
      metadata: { name: row.name },
    });
    return row;
  }

  const [row] = await db
    .insert(stationCategories)
    .values({
      name: input.name,
      description: input.description,
      color: input.color,
      maxPlayers: input.maxPlayers,
      playstationType: input.playstationType,
      pricingModel: input.pricingModel,
      sortOrder: input.sortOrder,
    })
    .returning();
  await recordAudit({
    action: "category.created",
    userId: user.id,
    userLabel: user.name,
    entityType: "station_category",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return row;
}

/** Deactivation is the normal retirement path and remains reversible. */
export async function setStationCategoryActive(id: string, isActive: boolean, user: SessionUser) {
  const [category] = await db
    .select({ id: stationCategories.id })
    .from(stationCategories)
    .where(eq(stationCategories.id, id))
    .limit(1);
  if (!category) throw new NotFoundError("Room type not found.");

  if (!isActive) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(stations)
      .where(and(eq(stations.categoryId, id), eq(stations.isActive, true)));
    if (row && row.count > 0) {
      throw new ConflictError(
        `${row.count} active station(s) still use this category. Move or deactivate them first.`,
      );
    }
  }
  const [updated] = await db
    .update(stationCategories)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(stationCategories.id, id))
    .returning({ id: stationCategories.id });
  if (!updated) throw new NotFoundError("Room type not found.");
  await recordAudit({
    action: isActive ? "category.updated" : "category.deactivated",
    userId: user.id,
    userLabel: user.name,
    entityType: "station_category",
    entityId: id,
    metadata: { isActive },
  });
}

/**
 * Permanently remove an unused room type.
 *
 * Historical pricing and operational records deliberately block deletion even
 * when they are inactive. Nothing is cascaded; administrators should deactivate
 * the room type when it has ever been used.
 */
export async function deleteStationCategory(id: string, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [category] = await tx.select().from(stationCategories).where(eq(stationCategories.id, id)).limit(1);
    if (!category) throw new NotFoundError("Room type not found.");

    const [[roomCount], [pricingCount], [sessionCount], [reservationCount], [transactionCount]] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` }).from(stations).where(eq(stations.categoryId, id)),
      tx.select({ count: sql<number>`count(*)::int` }).from(pricingRules).where(eq(pricingRules.categoryId, id)),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(gameSessions)
        .innerJoin(stations, eq(gameSessions.stationId, stations.id))
        .where(eq(stations.categoryId, id)),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(reservations)
        .innerJoin(stations, eq(reservations.stationId, stations.id))
        .where(eq(stations.categoryId, id)),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .innerJoin(stations, eq(transactions.stationId, stations.id))
        .where(eq(stations.categoryId, id)),
    ]);

    const dependencies = [
      [roomCount.count, "room"],
      [pricingCount.count, "pricing rule"],
      [sessionCount.count, "session"],
      [reservationCount.count, "reservation"],
      [transactionCount.count, "transaction"],
    ] as const;
    const blockers = dependencies
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`);

    if (blockers.length > 0) {
      throw new ConflictError(
        `${category.name} cannot be deleted because it has ${blockers.join(", ")}. Deactivate it instead to preserve history.`,
      );
    }

    await tx.delete(stationCategories).where(eq(stationCategories.id, id));
    await recordAudit(
      {
        action: "category.deleted",
        userId: user.id,
        userLabel: user.name,
        entityType: "station_category",
        entityId: id,
        metadata: { name: category.name },
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

export async function upsertStation(
  input: {
    id?: string;
    code: string;
    name: string;
    categoryId: string;
    color: string;
    colorStyle: "SOLID" | "GRADIENT";
    colorAccent: string;
    description: string | null;
    sortOrder: number;
  },
  user: SessionUser,
) {
  const code = input.code.toUpperCase();

  if (input.id) {
    const [existing] = await db.select().from(stations).where(eq(stations.id, input.id)).limit(1);
    if (!existing) throw new NotFoundError("Room not found.");
    if (existing.categoryId !== input.categoryId) {
      const [live] = await db
        .select({ id: gameSessions.id })
        .from(gameSessions)
        .where(and(eq(gameSessions.stationId, input.id), inArray(gameSessions.status, ["ACTIVE", "PAUSED"])))
        .limit(1);
      if (live) throw new ConflictError("Finish the active room session before changing its PlayStation type.");
    }
    const [row] = await db
      .update(stations)
      .set({
        code,
        name: input.name,
        categoryId: input.categoryId,
        color: input.color,
        colorStyle: input.colorStyle,
        colorAccent: input.colorAccent,
        description: input.description,
        sortOrder: input.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(stations.id, input.id))
      .returning();
    if (!row) throw new NotFoundError("Station not found.");
    await recordAudit({
      action: "station.updated",
      userId: user.id,
      userLabel: user.name,
      entityType: "station",
      entityId: row.id,
      metadata: { code: row.code },
    });
    return row;
  }

  const [row] = await db
    .insert(stations)
    .values({
      code,
      name: input.name,
      categoryId: input.categoryId,
      color: input.color,
      colorStyle: input.colorStyle,
      colorAccent: input.colorAccent,
      description: input.description,
      sortOrder: input.sortOrder,
    })
    .returning();
  await recordAudit({
    action: "station.created",
    userId: user.id,
    userLabel: user.name,
    entityType: "station",
    entityId: row.id,
    metadata: { code: row.code },
  });
  return row;
}

export async function setStationStatus(
  input: { stationId: string; status: "AVAILABLE" | "MAINTENANCE"; maintenanceReason: string | null },
  user: SessionUser,
) {
  const [station] = await db.select().from(stations).where(eq(stations.id, input.stationId)).limit(1);
  if (!station) throw new NotFoundError("Station not found.");

  const [live] = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.stationId, station.id), inArray(gameSessions.status, ["ACTIVE", "PAUSED"])))
    .limit(1);
  if (live) throw new ConflictError("Finish the live session on this station first.");

  await db
    .update(stations)
    .set({
      status: input.status,
      maintenanceReason: input.status === "MAINTENANCE" ? input.maintenanceReason : null,
      updatedAt: new Date(),
    })
    .where(eq(stations.id, station.id));

  await recordAudit({
    action: "station.status_changed",
    userId: user.id,
    userLabel: user.name,
    entityType: "station",
    entityId: station.id,
    metadata: { code: station.code, from: station.status, to: input.status, reason: input.maintenanceReason },
  });
}

export async function setStationActive(stationId: string, isActive: boolean, user: SessionUser) {
  const [live] = await db
    .select({ id: gameSessions.id })
    .from(gameSessions)
    .where(and(eq(gameSessions.stationId, stationId), inArray(gameSessions.status, ["ACTIVE", "PAUSED"])))
    .limit(1);
  if (live && !isActive) throw new ConflictError("Finish the live session on this station first.");

  await db
    .update(stations)
    .set({ isActive, status: isActive ? "AVAILABLE" : "MAINTENANCE", updatedAt: new Date() })
    .where(eq(stations.id, stationId));

  await recordAudit({
    action: isActive ? "station.updated" : "station.deactivated",
    userId: user.id,
    userLabel: user.name,
    entityType: "station",
    entityId: stationId,
    metadata: { isActive },
  });
}

/**
 * Permanently remove a station.
 *
 * Only possible while nothing financial points at it. Once a station has hosted
 * a session it is kept forever (deactivated instead), because deleting it would
 * orphan sessions and silently change historical income figures.
 */
export async function deleteStation(stationId: string, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [station] = await tx.select().from(stations).where(eq(stations.id, stationId)).limit(1);
    if (!station) throw new NotFoundError("Station not found.");

    const [{ sessions }] = await tx
      .select({ sessions: sql<number>`count(*)::int` })
      .from(gameSessions)
      .where(eq(gameSessions.stationId, stationId));
    if (sessions > 0) {
      throw new ConflictError(
        `${station.code} has ${sessions} session(s) in its history and cannot be deleted. Deactivate it instead — it will disappear from the board but its past bills stay correct.`,
      );
    }

    const [{ bookings }] = await tx
      .select({ bookings: sql<number>`count(*)::int` })
      .from(reservations)
      .where(eq(reservations.stationId, stationId));
    if (bookings > 0) {
      throw new ConflictError(`${station.code} has ${bookings} booking(s). Cancel them before deleting the station.`);
    }

    await tx.delete(stations).where(eq(stations.id, stationId));

    await recordAudit(
      {
        action: "station.deleted",
        userId: user.id,
        userLabel: user.name,
        entityType: "station",
        entityId: stationId,
        metadata: { code: station.code, name: station.name },
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Pricing rules                                                              */
/* -------------------------------------------------------------------------- */

export async function upsertPricingRule(
  input: {
    id?: string;
    categoryId: string;
    customerType: "REGULAR" | "MEMBER";
    timeBand: "NORMAL" | "NIGHT";
    kind: "SLAB" | "DAY_PASS";
    durationMinutes: number;
    playerCount: number;
    price: number;
  },
  user: SessionUser,
) {
  if (!Number.isInteger(input.playerCount) || input.playerCount < 1 || input.playerCount > 4) {
    throw new ConflictError("Player count must be between 1 and 4.");
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new ConflictError("Price must be greater than zero.");
  }

  const [category] = await db
    .select({ pricingModel: stationCategories.pricingModel })
    .from(stationCategories)
    .where(eq(stationCategories.id, input.categoryId))
    .limit(1);
  if (!category) throw new NotFoundError("Room category not found.");
  if (category.pricingModel === "ROOM" && (input.customerType !== "REGULAR" || input.timeBand !== "NORMAL")) {
    throw new ConflictError("Room pricing uses one regular rate table by player count.");
  }

  const values = {
    categoryId: input.categoryId,
    customerType: input.customerType,
    timeBand: input.timeBand,
    kind: input.kind,
    durationMinutes: input.durationMinutes,
    playerCount: input.playerCount,
    price: input.price,
    isActive: true,
    updatedAt: new Date(),
  };

  if (input.id) {
    const [row] = await db.update(pricingRules).set(values).where(eq(pricingRules.id, input.id)).returning();
    if (!row) throw new NotFoundError("Pricing rule not found.");
    await recordAudit({
      action: "pricing.updated",
      userId: user.id,
      userLabel: user.name,
      entityType: "pricing_rule",
      entityId: row.id,
      metadata: values,
    });
    return row;
  }

  // Re-activating a previously removed rule keeps the unique key satisfied.
  const [row] = await db
    .insert(pricingRules)
    .values(values)
    .onConflictDoUpdate({
      target: [
        pricingRules.categoryId,
        pricingRules.customerType,
        pricingRules.timeBand,
        pricingRules.kind,
        pricingRules.durationMinutes,
        pricingRules.playerCount,
      ],
      set: { price: values.price, isActive: true, updatedAt: new Date() },
    })
    .returning();

  await recordAudit({
    action: "pricing.created",
    userId: user.id,
    userLabel: user.name,
    entityType: "pricing_rule",
    entityId: row.id,
    metadata: values,
  });
  return row;
}

/**
 * Pricing rules are deactivated rather than deleted so that the breakdown
 * stored on old transactions can always be explained.
 */
export async function deactivatePricingRule(id: string, user: SessionUser) {
  const [row] = await db
    .update(pricingRules)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(pricingRules.id, id))
    .returning();
  if (!row) throw new NotFoundError("Pricing rule not found.");
  await recordAudit({
    action: "pricing.deleted",
    userId: user.id,
    userLabel: user.name,
    entityType: "pricing_rule",
    entityId: id,
    metadata: { categoryId: row.categoryId, durationMinutes: row.durationMinutes },
  });
}

/* -------------------------------------------------------------------------- */
/* Food menu                                                                  */
/* -------------------------------------------------------------------------- */

export async function upsertFoodCategory(input: { id?: string; name: string; sortOrder: number }, user: SessionUser) {
  if (input.id) {
    const [row] = await db
      .update(foodCategories)
      .set({ name: input.name, sortOrder: input.sortOrder, updatedAt: new Date() })
      .where(eq(foodCategories.id, input.id))
      .returning();
    if (!row) throw new NotFoundError("Food category not found.");
    await recordAudit({
      action: "food.category_updated",
      userId: user.id,
      userLabel: user.name,
      entityType: "food_category",
      entityId: row.id,
      metadata: { name: row.name },
    });
    return row;
  }
  const [row] = await db
    .insert(foodCategories)
    .values({ name: input.name, sortOrder: input.sortOrder })
    .returning();
  await recordAudit({
    action: "food.category_created",
    userId: user.id,
    userLabel: user.name,
    entityType: "food_category",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return row;
}

export async function setFoodCategoryActive(id: string, isActive: boolean, user: SessionUser) {
  if (!isActive) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(foodItems)
      .where(and(eq(foodItems.categoryId, id), eq(foodItems.isActive, true)));
    if (row && row.count > 0) {
      throw new ConflictError(`${row.count} active item(s) still use this category.`);
    }
  }
  await db.update(foodCategories).set({ isActive, updatedAt: new Date() }).where(eq(foodCategories.id, id));
  await recordAudit({
    action: "food.category_updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "food_category",
    entityId: id,
    metadata: { isActive },
  });
}

export async function upsertFoodItem(
  input: {
    id?: string;
    name: string;
    categoryId: string;
    price: number;
    /** Null when members pay the ordinary price for this item. */
    memberPrice: number | null;
    description: string | null;
    imageUrl: string | null;
    taxPercent: number;
    prepMinutes: number | null;
    isAvailable: boolean;
  },
  user: SessionUser,
) {
  const values = {
    name: input.name,
    categoryId: input.categoryId,
    price: input.price,
    memberPrice: input.memberPrice,
    description: input.description,
    imageUrl: input.imageUrl,
    taxPercent: input.taxPercent,
    prepMinutes: input.prepMinutes,
    isAvailable: input.isAvailable,
    updatedAt: new Date(),
  };

  if (input.id) {
    const [row] = await db.update(foodItems).set(values).where(eq(foodItems.id, input.id)).returning();
    if (!row) throw new NotFoundError("Menu item not found.");
    await recordAudit({
      action: "food.item_updated",
      userId: user.id,
      userLabel: user.name,
      entityType: "food_item",
      entityId: row.id,
      metadata: { name: row.name, price: row.price },
    });
    return row;
  }

  const [row] = await db.insert(foodItems).values(values).returning();
  await recordAudit({
    action: "food.item_created",
    userId: user.id,
    userLabel: user.name,
    entityType: "food_item",
    entityId: row.id,
    metadata: { name: row.name, price: row.price },
  });
  return row;
}

/** Soft delete: past orders keep pointing at the item row. */
export async function setFoodItemActive(id: string, isActive: boolean, user: SessionUser) {
  const [row] = await db
    .update(foodItems)
    .set({ isActive, isAvailable: isActive, updatedAt: new Date() })
    .where(eq(foodItems.id, id))
    .returning();
  if (!row) throw new NotFoundError("Menu item not found.");
  await recordAudit({
    action: isActive ? "food.item_updated" : "food.item_deactivated",
    userId: user.id,
    userLabel: user.name,
    entityType: "food_item",
    entityId: id,
    metadata: { name: row.name, isActive },
  });
}

export async function setFoodItemAvailability(id: string, isAvailable: boolean, user: SessionUser) {
  const [row] = await db
    .update(foodItems)
    .set({ isAvailable, updatedAt: new Date() })
    .where(eq(foodItems.id, id))
    .returning();
  if (!row) throw new NotFoundError("Menu item not found.");
  await recordAudit({
    action: "food.item_updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "food_item",
    entityId: id,
    metadata: { name: row.name, isAvailable },
  });
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                      */
/* -------------------------------------------------------------------------- */

export async function listStaff() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      canDiscount: users.canDiscount,
      maxDiscountPercent: users.maxDiscountPercent,
      canViewSensitive: users.canViewSensitive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.name));
}

export async function createStaff(
  input: {
    name: string;
    email: string;
    password: string;
    role: "ADMIN" | "MANAGER" | "STAFF";
    canDiscount: boolean;
    maxDiscountPercent: number;
    canViewSensitive: boolean;
  },
  user: SessionUser,
) {
  const [row] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      canDiscount: input.canDiscount,
      maxDiscountPercent: input.maxDiscountPercent,
      canViewSensitive: input.role === "ADMIN" ? input.canViewSensitive : false,
    })
    .returning();

  await recordAudit({
    action: "staff.created",
    userId: user.id,
    userLabel: user.name,
    entityType: "user",
    entityId: row.id,
    metadata: { name: row.name, role: row.role },
  });
  return row;
}

export async function updateStaff(
  input: {
    id: string;
    name: string;
    password?: string;
    role: "ADMIN" | "MANAGER" | "STAFF";
    canDiscount: boolean;
    maxDiscountPercent: number;
    canViewSensitive: boolean;
    isActive: boolean;
  },
  user: SessionUser,
) {
  if (input.id === user.id && (!input.isActive || input.role !== "ADMIN")) {
    throw new ValidationError("You cannot remove your own admin access or deactivate yourself.");
  }

  if (!input.isActive || input.role !== "ADMIN") {
    const [admins] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, "ADMIN"), eq(users.isActive, true), ne(users.id, input.id)));
    if (!admins || admins.count === 0) {
      throw new ValidationError("At least one active admin account must remain.");
    }
  }

  const values: Partial<typeof users.$inferInsert> = {
    name: input.name,
    role: input.role,
    canDiscount: input.canDiscount,
    maxDiscountPercent: input.maxDiscountPercent,
    canViewSensitive: input.role === "ADMIN" ? input.canViewSensitive : false,
    isActive: input.isActive,
    updatedAt: new Date(),
  };
  if (input.password) values.passwordHash = await hashPassword(input.password);

  const [row] = await db.update(users).set(values).where(eq(users.id, input.id)).returning();
  if (!row) throw new NotFoundError("Staff account not found.");

  await recordAudit({
    action: input.isActive ? "staff.updated" : "staff.deactivated",
    userId: user.id,
    userLabel: user.name,
    entityType: "user",
    entityId: row.id,
    metadata: { name: row.name, role: row.role, isActive: row.isActive, passwordChanged: Boolean(input.password) },
  });
  return row;
}

/* -------------------------------------------------------------------------- */
/* Business settings                                                          */
/* -------------------------------------------------------------------------- */

export async function updateSettings(
  input: Omit<typeof businessSettings.$inferInsert, "id" | "invoiceCounter" | "updatedAt">,
  user: SessionUser,
) {
  // Fail fast on an unusable timezone rather than breaking every report later.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone }).format(new Date());
  } catch {
    throw new ValidationError(`"${input.timezone}" is not a valid IANA timezone (e.g. Asia/Kolkata).`);
  }
  parseHHmm(input.nightStart ?? "23:00");
  parseHHmm(input.nightEnd ?? "06:00");

  const [row] = await db
    .update(businessSettings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(businessSettings.id, 1))
    .returning();

  await recordAudit({
    action: "settings.updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "settings",
    entityId: "1",
    metadata: { cafeName: row.cafeName, nightStart: row.nightStart, nightEnd: row.nightEnd },
  });
  return row;
}
