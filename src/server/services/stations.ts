import "server-only";

import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import {
  foodOrderItems,
  foodOrders,
  gameSessions,
  members,
  memberships,
  reservations,
  sessionPauses,
  sessionPlayers,
  stationCategories,
  stations,
  users,
  type StationStatus,
} from "@/db/schema";
import { parseHHmm } from "@/lib/time";
import { hourlyDisplayRate, roomHourlyDisplayRate, type EnginePricingRule, type PricingConfig, type RoomPricingSnapshot } from "@/server/pricing/engine";
import { getRulesByCategory } from "@/server/services/pricing";
import { getSettings } from "@/server/services/settings";

/* -------------------------------------------------------------------------- */
/* Board DTOs (everything below is safe to send to a client component)        */
/* -------------------------------------------------------------------------- */

export type BoardPause = { pausedAt: string; resumedAt: string | null };

export type BoardFoodLine = {
  orderId: string;
  orderCode: string;
  status: string;
  name: string;
  quantity: number;
  lineTotal: number;
  taxAmount: number;
};

export type BoardPlayer = {
  slot: number;
  /** Member's name, or "Player 2" for a guest. */
  label: string;
  customerType: "REGULAR" | "MEMBER";
  memberId: string | null;
  memberCode: string | null;
  membershipValidUntil: string | null;
};

export type BoardSession = {
  id: string;
  code: string;
  startedAt: string;
  status: "ACTIVE" | "PAUSED";
  customerName: string | null;
  customerMobile: string | null;
  customerType: "REGULAR" | "MEMBER";
  memberId: string | null;
  memberName: string | null;
  memberCode: string | null;
  membershipValidUntil: string | null;
  plannedMinutes: number | null;
  playerCount: number;
  pricingModel: "PER_PLAYER" | "ROOM";
  pricingSnapshot: RoomPricingSnapshot | null;
  /** Everyone on the station. Always at least one entry. */
  players: BoardPlayer[];
  pauses: BoardPause[];
  foodAmount: number;
  foodTaxAmount: number;
  foodLines: BoardFoodLine[];
  startedByName: string;
};

export type BoardStation = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  pricingModel: "PER_PLAYER" | "ROOM";
  playstationType: "PS4" | "PS5" | null;
  color: string;
  colorStyle: "SOLID" | "GRADIENT";
  colorAccent: string;
  /** Seats on this station. 1 hides the player picker entirely. */
  maxPlayers: number;
  status: StationStatus;
  maintenanceReason: string | null;
  description: string | null;
  hourlyRate: number | null;
  memberHourlyRate: number | null;
  roomHourlyRates: Record<number, number | null>;
  session: BoardSession | null;
  upcomingReservation: { id: string; customerName: string; startTime: string; endTime: string } | null;
};

export type BoardCategory = {
  id: string;
  name: string;
  color: string;
  maxPlayers: number;
  pricingModel: "PER_PLAYER" | "ROOM";
  playstationType: "PS4" | "PS5" | null;
  rules: EnginePricingRule[];
};

export type StationBoard = {
  stations: BoardStation[];
  categories: BoardCategory[];
  pricingConfig: PricingConfig;
  currencySymbol: string;
  taxEnabled: boolean;
  serverNow: string;
};

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export async function listCategories(includeInactive = false, client: DbClient = db) {
  return client
    .select()
    .from(stationCategories)
    .where(includeInactive ? sql`true` : eq(stationCategories.isActive, true))
    .orderBy(asc(stationCategories.sortOrder), asc(stationCategories.name));
}

export async function listStations(includeInactive = false, client: DbClient = db) {
  return client
    .select({
      id: stations.id,
      code: stations.code,
      name: stations.name,
      categoryId: stations.categoryId,
      categoryName: stationCategories.name,
      maxPlayers: stationCategories.maxPlayers,
      pricingModel: stationCategories.pricingModel,
      playstationType: stationCategories.playstationType,
      color: stations.color,
      colorStyle: stations.colorStyle,
      colorAccent: stations.colorAccent,
      description: stations.description,
      status: stations.status,
      maintenanceReason: stations.maintenanceReason,
      sortOrder: stations.sortOrder,
      isActive: stations.isActive,
      createdAt: stations.createdAt,
    })
    .from(stations)
    .innerJoin(stationCategories, eq(stations.categoryId, stationCategories.id))
    .where(includeInactive ? sql`true` : eq(stations.isActive, true))
    .orderBy(asc(stations.sortOrder), asc(stations.code));
}

/**
 * The operational board: every active station with its live session, running
 * food total and the pricing inputs needed to tick a live bill in the browser.
 *
 * One query per concern rather than a single monster join — Postgres answers
 * each in well under a millisecond on cafe-sized data, and the code stays
 * readable.
 */
export async function getStationBoard(client: DbClient = db): Promise<StationBoard> {
  const settings = await getSettings();

  const [stationRows, rulesByCategory, categoryRows] = await Promise.all([
    listStations(false, client),
    getRulesByCategory(client),
    listCategories(false, client),
  ]);

  const liveSessions = await client
    .select({
      id: gameSessions.id,
      code: gameSessions.code,
      stationId: gameSessions.stationId,
      startedAt: gameSessions.startedAt,
      status: gameSessions.status,
      customerName: gameSessions.customerName,
      customerMobile: gameSessions.customerMobile,
      customerType: gameSessions.customerType,
      memberId: gameSessions.memberId,
      memberName: members.fullName,
      memberCode: members.memberCode,
      membershipValidUntil: memberships.endDate,
      plannedMinutes: gameSessions.plannedMinutes,
      playerCount: gameSessions.playerCount,
      pricingModel: gameSessions.pricingModel,
      pricingSnapshot: gameSessions.pricingSnapshot,
      // Joined rather than fetched with a correlated raw-SQL subquery: column
      // names interpolated into `sql` render unqualified and can bind to the
      // wrong table.
      startedByName: users.name,
    })
    .from(gameSessions)
    .leftJoin(members, eq(gameSessions.memberId, members.id))
    .leftJoin(memberships, eq(gameSessions.membershipId, memberships.id))
    .leftJoin(users, eq(gameSessions.startedById, users.id))
    .where(inArray(gameSessions.status, ["ACTIVE", "PAUSED"]));

  const sessionIds = liveSessions.map((session) => session.id);

  const playerRows = sessionIds.length
    ? await client
        .select({
          sessionId: sessionPlayers.sessionId,
          slot: sessionPlayers.slot,
          name: sessionPlayers.name,
          customerType: sessionPlayers.customerType,
          memberId: sessionPlayers.memberId,
          memberCode: members.memberCode,
          membershipValidUntil: sessionPlayers.membershipValidUntil,
        })
        .from(sessionPlayers)
        .leftJoin(members, eq(sessionPlayers.memberId, members.id))
        .where(inArray(sessionPlayers.sessionId, sessionIds))
        .orderBy(asc(sessionPlayers.slot))
    : [];

  const playersBySession = new Map<string, BoardPlayer[]>();
  for (const row of playerRows) {
    const list = playersBySession.get(row.sessionId) ?? [];
    list.push({
      slot: row.slot,
      label: row.name ?? `Player ${row.slot}`,
      customerType: row.customerType,
      memberId: row.memberId,
      memberCode: row.memberCode,
      membershipValidUntil: row.membershipValidUntil?.toISOString() ?? null,
    });
    playersBySession.set(row.sessionId, list);
  }

  const [pauseRows, foodRows] = await Promise.all([
    sessionIds.length
      ? client
          .select()
          .from(sessionPauses)
          .where(inArray(sessionPauses.sessionId, sessionIds))
          .orderBy(asc(sessionPauses.pausedAt))
      : Promise.resolve([]),
    sessionIds.length
      ? client
          .select({
            sessionId: foodOrders.sessionId,
            orderId: foodOrders.id,
            orderCode: foodOrders.code,
            status: foodOrders.status,
            name: foodOrderItems.nameSnapshot,
            quantity: foodOrderItems.quantity,
            lineTotal: foodOrderItems.lineTotal,
            taxAmount: foodOrderItems.taxAmount,
          })
          .from(foodOrders)
          .innerJoin(foodOrderItems, eq(foodOrderItems.orderId, foodOrders.id))
          .where(and(inArray(foodOrders.sessionId, sessionIds), ne(foodOrders.status, "CANCELLED")))
          .orderBy(asc(foodOrders.createdAt))
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const reservationRows = await client
    .select({
      id: reservations.id,
      stationId: reservations.stationId,
      customerName: reservations.customerName,
      startTime: reservations.startTime,
      endTime: reservations.endTime,
    })
    .from(reservations)
    .where(and(eq(reservations.status, "BOOKED"), gte(reservations.endTime, now)))
    .orderBy(asc(reservations.startTime));

  const pausesBySession = new Map<string, BoardPause[]>();
  for (const row of pauseRows) {
    const list = pausesBySession.get(row.sessionId) ?? [];
    list.push({ pausedAt: row.pausedAt.toISOString(), resumedAt: row.resumedAt?.toISOString() ?? null });
    pausesBySession.set(row.sessionId, list);
  }

  const foodBySession = new Map<string, { lines: BoardFoodLine[]; total: number; tax: number }>();
  for (const row of foodRows) {
    const entry = foodBySession.get(row.sessionId) ?? { lines: [], total: 0, tax: 0 };
    entry.lines.push({
      orderId: row.orderId,
      orderCode: row.orderCode,
      status: row.status,
      name: row.name,
      quantity: row.quantity,
      lineTotal: row.lineTotal,
      taxAmount: row.taxAmount,
    });
    entry.total += row.lineTotal;
    entry.tax += settings.taxEnabled ? row.taxAmount : 0;
    foodBySession.set(row.sessionId, entry);
  }

  const sessionByStation = new Map<string, BoardSession>();
  for (const session of liveSessions) {
    const food = foodBySession.get(session.id) ?? { lines: [], total: 0, tax: 0 };
    sessionByStation.set(session.stationId, {
      id: session.id,
      code: session.code,
      startedAt: session.startedAt.toISOString(),
      status: session.status === "PAUSED" ? "PAUSED" : "ACTIVE",
      customerName: session.customerName,
      customerMobile: session.customerMobile,
      customerType: session.customerType,
      memberId: session.memberId,
      memberName: session.memberName,
      memberCode: session.memberCode,
      membershipValidUntil: session.membershipValidUntil?.toISOString() ?? null,
      plannedMinutes: session.plannedMinutes,
      playerCount: session.playerCount,
      pricingModel: session.pricingModel,
      pricingSnapshot: session.pricingSnapshot as RoomPricingSnapshot | null,
      players: playersBySession.get(session.id) ?? [
        {
          slot: 1,
          label: session.customerName ?? "Player 1",
          customerType: session.customerType,
          memberId: session.memberId,
          memberCode: session.memberCode,
          membershipValidUntil: session.membershipValidUntil?.toISOString() ?? null,
        },
      ],
      pauses: pausesBySession.get(session.id) ?? [],
      foodAmount: food.total,
      foodTaxAmount: food.tax,
      foodLines: food.lines,
      startedByName: session.startedByName ?? "—",
    });
  }

  const reservationByStation = new Map<string, BoardStation["upcomingReservation"]>();
  for (const reservation of reservationRows) {
    if (reservationByStation.has(reservation.stationId)) continue;
    reservationByStation.set(reservation.stationId, {
      id: reservation.id,
      customerName: reservation.customerName,
      startTime: reservation.startTime.toISOString(),
      endTime: reservation.endTime.toISOString(),
    });
  }

  const pricingConfig: PricingConfig = {
    timezone: settings.timezone,
    nightStartMinute: parseHHmm(settings.nightStart),
    nightEndMinute: parseHHmm(settings.nightEnd),
    dayPassEnabled: settings.dayPassEnabled,
    dayPassMinutes: settings.dayPassMinutes,
    minimumBillMinutes: settings.minimumBillMinutes,
    billingMode: settings.billingMode,
  };

  const board: BoardStation[] = stationRows.map((station) => {
    const rules = rulesByCategory.get(station.categoryId) ?? [];
    return {
      id: station.id,
      code: station.code,
      name: station.name,
      categoryId: station.categoryId,
      categoryName: station.categoryName,
      pricingModel: station.pricingModel,
      playstationType: station.playstationType,
      color: station.color,
      colorStyle: station.colorStyle,
      colorAccent: station.colorAccent,
      maxPlayers: station.maxPlayers,
      status: station.status,
      maintenanceReason: station.maintenanceReason,
      description: station.description,
      hourlyRate:
        station.pricingModel === "ROOM"
          ? roomHourlyDisplayRate(rules, pricingConfig, 1, now)
          : hourlyDisplayRate(rules, pricingConfig, "REGULAR", now),
      memberHourlyRate:
        station.pricingModel === "ROOM" ? null : hourlyDisplayRate(rules, pricingConfig, "MEMBER", now),
      roomHourlyRates: Object.fromEntries(
        [1, 2, 3, 4].map((count) => [count, roomHourlyDisplayRate(rules, pricingConfig, count, now)]),
      ),
      session: sessionByStation.get(station.id) ?? null,
      upcomingReservation: reservationByStation.get(station.id) ?? null,
    };
  });

  return {
    stations: board,
    categories: categoryRows.map((category) => ({
      id: category.id,
      name: category.name,
      color: category.color,
      maxPlayers: category.maxPlayers,
      pricingModel: category.pricingModel,
      playstationType: category.playstationType,
      rules: rulesByCategory.get(category.id) ?? [],
    })),
    pricingConfig,
    currencySymbol: settings.currencySymbol,
    taxEnabled: settings.taxEnabled,
    serverNow: now.toISOString(),
  };
}

/** Stations that currently hold no live session, for reservation pickers. */
export async function listSelectableStations(client: DbClient = db) {
  return client
    .select({
      id: stations.id,
      code: stations.code,
      name: stations.name,
      status: stations.status,
      categoryName: stationCategories.name,
    })
    .from(stations)
    .innerJoin(stationCategories, eq(stations.categoryId, stationCategories.id))
    .where(and(eq(stations.isActive, true), or(isNull(stations.maintenanceReason), sql`true`)))
    .orderBy(asc(stations.sortOrder), asc(stations.code));
}
