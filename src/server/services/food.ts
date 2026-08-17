import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import {
  foodCategories,
  foodItems,
  foodOrderItems,
  foodOrders,
  gameSessions,
  sessionPlayers,
  stations,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { foodOrderCode } from "@/lib/codes";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getSettingsFor } from "@/server/services/settings";

export async function listFoodCategories(includeInactive = false, client: DbClient = db) {
  return client
    .select()
    .from(foodCategories)
    .where(includeInactive ? sql`true` : eq(foodCategories.isActive, true))
    .orderBy(asc(foodCategories.sortOrder), asc(foodCategories.name));
}

export type MenuItem = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  /** Null when members pay the ordinary price for this item. */
  memberPrice: number | null;
  description: string | null;
  imageUrl: string | null;
  taxPercent: number;
  prepMinutes: number | null;
  isAvailable: boolean;
  isActive: boolean;
};

export async function listFoodItems(includeInactive = false, client: DbClient = db): Promise<MenuItem[]> {
  return client
    .select({
      id: foodItems.id,
      name: foodItems.name,
      categoryId: foodItems.categoryId,
      categoryName: foodCategories.name,
      price: foodItems.price,
      memberPrice: foodItems.memberPrice,
      description: foodItems.description,
      imageUrl: foodItems.imageUrl,
      taxPercent: foodItems.taxPercent,
      prepMinutes: foodItems.prepMinutes,
      isAvailable: foodItems.isAvailable,
      isActive: foodItems.isActive,
    })
    .from(foodItems)
    .innerJoin(foodCategories, eq(foodItems.categoryId, foodCategories.id))
    .where(includeInactive ? sql`true` : eq(foodItems.isActive, true))
    .orderBy(asc(foodCategories.sortOrder), asc(foodCategories.name), asc(foodItems.name));
}

/** Items a staff member can actually order right now. */
export async function getOrderableMenu(client: DbClient = db) {
  const items = await client
    .select({
      id: foodItems.id,
      name: foodItems.name,
      categoryId: foodItems.categoryId,
      categoryName: foodCategories.name,
      price: foodItems.price,
      memberPrice: foodItems.memberPrice,
      taxPercent: foodItems.taxPercent,
      prepMinutes: foodItems.prepMinutes,
    })
    .from(foodItems)
    .innerJoin(foodCategories, eq(foodItems.categoryId, foodCategories.id))
    .where(and(eq(foodItems.isActive, true), eq(foodItems.isAvailable, true), eq(foodCategories.isActive, true)))
    .orderBy(asc(foodCategories.sortOrder), asc(foodCategories.name), asc(foodItems.name));
  return items;
}

/**
 * What this item costs on this station.
 *
 * A member deal applies when *anyone* on the station holds a valid membership
 * — the cafe's own rule, so a mixed table is not an argument at the counter.
 * An item with no member price simply costs what it always did.
 */
export function foodPriceFor(
  item: { price: number; memberPrice: number | null },
  memberRates: boolean,
): number {
  if (!memberRates || item.memberPrice === null) return item.price;
  return Math.min(item.memberPrice, item.price);
}

/** True when at least one person on the station is on member rates. */
export async function sessionHasMember(sessionId: string, client: DbClient = db): Promise<boolean> {
  const [row] = await client
    .select({ found: sql<number>`count(*)::int` })
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, sessionId), eq(sessionPlayers.customerType, "MEMBER")))
    .limit(1);
  if ((row?.found ?? 0) > 0) return true;

  // A session started before the player list existed still describes its
  // customer on the session row itself.
  const [session] = await client
    .select({ customerType: gameSessions.customerType })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  return session?.customerType === "MEMBER";
}

export type CreateFoodOrderInput = {
  sessionId: string;
  notes: string | null;
  items: { foodItemId: string; quantity: number }[];
};

/**
 * Attach a food order to a live gaming session.
 * Prices and names are snapshotted onto the order lines, so retiring an item
 * or changing its price later never rewrites an existing bill.
 */
export async function createFoodOrder(input: CreateFoodOrderInput, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: gameSessions.id, status: gameSessions.status, code: gameSessions.code })
      .from(gameSessions)
      .where(eq(gameSessions.id, input.sessionId))
      .limit(1);

    if (!session) throw new NotFoundError("Session not found.");
    if (session.status === "COMPLETED" || session.status === "CANCELLED") {
      throw new ConflictError("This session is closed — start a new session to add food.");
    }

    const settings = await getSettingsFor(tx);
    // Resolved once per order, inside the transaction, so the price charged
    // cannot drift from what the counter saw a moment earlier.
    const memberRates = await sessionHasMember(input.sessionId, tx);
    const ids = [...new Set(input.items.map((item) => item.foodItemId))];
    const rows = await tx.select().from(foodItems).where(inArray(foodItems.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const id of ids) {
      const item = byId.get(id);
      if (!item || !item.isActive) throw new NotFoundError("One of the selected items is no longer on the menu.");
      if (!item.isAvailable) throw new ValidationError(`${item.name} is marked unavailable right now.`);
    }

    const now = new Date();
    const [order] = await tx
      .insert(foodOrders)
      .values({
        code: foodOrderCode(now),
        sessionId: input.sessionId,
        status: "ORDERED",
        notes: input.notes,
        createdById: user.id,
      })
      .returning();

    const lines = input.items.map((line) => {
      const item = byId.get(line.foodItemId)!;
      const unitPrice = foodPriceFor(item, memberRates);
      const lineTotal = unitPrice * line.quantity;
      const taxAmount = settings.taxEnabled ? Math.round((lineTotal * item.taxPercent) / 100) : 0;
      return {
        orderId: order.id,
        foodItemId: item.id,
        nameSnapshot: item.name,
        unitPrice,
        taxPercent: item.taxPercent,
        quantity: line.quantity,
        lineTotal,
        taxAmount,
      };
    });

    await tx.insert(foodOrderItems).values(lines);

    const total = lines.reduce((sum, line) => sum + line.lineTotal + line.taxAmount, 0);

    await recordAudit(
      {
        action: "food.order_created",
        userId: user.id,
        userLabel: user.name,
        entityType: "food_order",
        entityId: order.id,
        metadata: {
          sessionCode: session.code,
          orderCode: order.code,
          itemCount: lines.length,
          total,
          memberRates,
        },
      },
      tx,
    );

    return { order, total };
  });
}

export async function setFoodOrderStatus(
  orderId: string,
  status: "ORDERED" | "PREPARING" | "READY" | "SERVED",
  user: SessionUser,
) {
  const [order] = await db.select().from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
  if (!order) throw new NotFoundError("Food order not found.");
  if (order.status === "CANCELLED") throw new ConflictError("This order was cancelled.");

  await db.update(foodOrders).set({ status, updatedAt: new Date() }).where(eq(foodOrders.id, orderId));
  await recordAudit({
    action: "food.order_status_changed",
    userId: user.id,
    userLabel: user.name,
    entityType: "food_order",
    entityId: orderId,
    metadata: { from: order.status, to: status },
  });
}

/**
 * Cancelling keeps the order row (and its history) but removes it from the
 * bill. Orders belonging to an already-paid session cannot be cancelled.
 */
export async function cancelFoodOrder(orderId: string, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(foodOrders).where(eq(foodOrders.id, orderId)).limit(1);
    if (!order) throw new NotFoundError("Food order not found.");
    if (order.status === "CANCELLED") return;

    const [session] = await tx
      .select({ status: gameSessions.status })
      .from(gameSessions)
      .where(eq(gameSessions.id, order.sessionId))
      .limit(1);
    if (session?.status === "COMPLETED") {
      throw new ConflictError("This session has already been paid — a refund must be recorded instead.");
    }

    await tx.update(foodOrders).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(foodOrders.id, orderId));
    await recordAudit(
      {
        action: "food.order_cancelled",
        userId: user.id,
        userLabel: user.name,
        entityType: "food_order",
        entityId: orderId,
        metadata: { orderCode: order.code },
      },
      tx,
    );
  });
}

/** Live kitchen queue — every non-served order across active sessions. */
export async function listOpenFoodOrders(client: DbClient = db) {
  return client
    .select({
      id: foodOrders.id,
      code: foodOrders.code,
      status: foodOrders.status,
      createdAt: foodOrders.createdAt,
      sessionId: foodOrders.sessionId,
      sessionCode: gameSessions.code,
      stationCode: stations.code,
      stationName: stations.name,
      items: sql<string>`string_agg(${foodOrderItems.nameSnapshot} || ' x' || ${foodOrderItems.quantity}, ', ' order by ${foodOrderItems.nameSnapshot})`,
      total: sql<number>`coalesce(sum(${foodOrderItems.lineTotal} + ${foodOrderItems.taxAmount}), 0)::int`,
    })
    .from(foodOrders)
    .innerJoin(gameSessions, eq(foodOrders.sessionId, gameSessions.id))
    .innerJoin(stations, eq(gameSessions.stationId, stations.id))
    .innerJoin(foodOrderItems, eq(foodOrderItems.orderId, foodOrders.id))
    .where(and(ne(foodOrders.status, "CANCELLED"), ne(foodOrders.status, "SERVED")))
    .groupBy(foodOrders.id, gameSessions.code, stations.code, stations.name)
    .orderBy(desc(foodOrders.createdAt))
    .limit(50);
}
