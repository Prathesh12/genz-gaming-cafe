import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import {
  foodOrderItems,
  foodOrders,
  gameSessions,
  members,
  memberships,
  stations,
  transactions,
  users,
} from "@/db/schema";
import { addDaysInZone, endOfDayInZone, fromDateKey, startOfDayInZone, toDateKey } from "@/lib/time";
import { getSettings } from "@/server/services/settings";

export type RangePreset = "today" | "yesterday" | "week" | "month" | "custom";

export type DateRange = { from: Date; to: Date; label: string; preset: RangePreset };

/** Resolve a UI preset into concrete UTC instants using the cafe's timezone. */
export async function resolveRange(
  preset: RangePreset = "today",
  fromKey?: string,
  toKey?: string,
): Promise<DateRange> {
  const settings = await getSettings();
  const tz = settings.timezone;
  const now = new Date();

  switch (preset) {
    case "yesterday": {
      const start = addDaysInZone(startOfDayInZone(now, tz), -1, tz);
      return { from: start, to: startOfDayInZone(now, tz), label: "Yesterday", preset };
    }
    case "week": {
      const start = addDaysInZone(startOfDayInZone(now, tz), -6, tz);
      return { from: start, to: endOfDayInZone(now, tz), label: "Last 7 days", preset };
    }
    case "month": {
      const start = addDaysInZone(startOfDayInZone(now, tz), -29, tz);
      return { from: start, to: endOfDayInZone(now, tz), label: "Last 30 days", preset };
    }
    case "custom": {
      if (fromKey && toKey) {
        const from = fromDateKey(fromKey, tz);
        const to = addDaysInZone(fromDateKey(toKey, tz), 1, tz);
        return { from, to, label: `${fromKey} → ${toKey}`, preset };
      }
      return { from: startOfDayInZone(now, tz), to: endOfDayInZone(now, tz), label: "Today", preset: "today" };
    }
    default:
      return { from: startOfDayInZone(now, tz), to: endOfDayInZone(now, tz), label: "Today", preset: "today" };
  }
}

const completedIn = (range: DateRange): SQL =>
  and(
    eq(transactions.status, "COMPLETED"),
    gte(transactions.createdAt, range.from),
    lt(transactions.createdAt, range.to),
  )!;

export type IncomeTotals = {
  transactionCount: number;
  gaming: number;
  food: number;
  tax: number;
  discount: number;
  total: number;
  cash: number;
  upi: number;
  splitCount: number;
  averageTicket: number;
  averageMinutes: number;
  memberRevenue: number;
  regularRevenue: number;
};

/**
 * Headline totals. Split payments are counted once in `total` and their two
 * halves land in `cash` and `upi` respectively — never double counted.
 */
export async function getIncomeTotals(range: DateRange, client: DbClient = db): Promise<IncomeTotals> {
  const [row] = await client
    .select({
      transactionCount: sql<number>`count(*)::int`,
      gaming: sql<number>`coalesce(sum(${transactions.gamingAmount}), 0)::int`,
      food: sql<number>`coalesce(sum(${transactions.foodAmount}), 0)::int`,
      tax: sql<number>`coalesce(sum(${transactions.taxAmount}), 0)::int`,
      discount: sql<number>`coalesce(sum(${transactions.discountAmount}), 0)::int`,
      total: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)::int`,
      cash: sql<number>`coalesce(sum(${transactions.cashAmount}), 0)::int`,
      upi: sql<number>`coalesce(sum(${transactions.upiAmount}), 0)::int`,
      splitCount: sql<number>`count(*) filter (where ${transactions.paymentMethod} = 'SPLIT')::int`,
      averageMinutes: sql<number>`coalesce(avg(${transactions.billedMinutes}), 0)::int`,
      memberRevenue: sql<number>`coalesce(sum(${transactions.totalAmount}) filter (where ${transactions.customerType} = 'MEMBER'), 0)::int`,
      regularRevenue: sql<number>`coalesce(sum(${transactions.totalAmount}) filter (where ${transactions.customerType} = 'REGULAR'), 0)::int`,
    })
    .from(transactions)
    .where(completedIn(range));

  const totals = row ?? {
    transactionCount: 0,
    gaming: 0,
    food: 0,
    tax: 0,
    discount: 0,
    total: 0,
    cash: 0,
    upi: 0,
    splitCount: 0,
    averageMinutes: 0,
    memberRevenue: 0,
    regularRevenue: 0,
  };

  return {
    ...totals,
    averageTicket: totals.transactionCount > 0 ? Math.round(totals.total / totals.transactionCount) : 0,
  };
}

export type StationIncomeRow = {
  stationId: string;
  station: string;
  category: string;
  sessions: number;
  gaming: number;
  food: number;
  total: number;
  minutes: number;
};

export async function getStationIncome(range: DateRange, client: DbClient = db): Promise<StationIncomeRow[]> {
  return client
    .select({
      stationId: transactions.stationId,
      station: transactions.stationSnapshot,
      category: transactions.categorySnapshot,
      sessions: sql<number>`count(*)::int`,
      gaming: sql<number>`coalesce(sum(${transactions.gamingAmount}), 0)::int`,
      food: sql<number>`coalesce(sum(${transactions.foodAmount}), 0)::int`,
      total: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)::int`,
      minutes: sql<number>`coalesce(sum(${transactions.billedMinutes}), 0)::int`,
    })
    .from(transactions)
    .where(completedIn(range))
    .groupBy(transactions.stationId, transactions.stationSnapshot, transactions.categorySnapshot)
    .orderBy(desc(sql`sum(${transactions.totalAmount})`));
}

export async function getCategoryIncome(range: DateRange, client: DbClient = db) {
  return client
    .select({
      category: transactions.categorySnapshot,
      sessions: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)::int`,
    })
    .from(transactions)
    .where(completedIn(range))
    .groupBy(transactions.categorySnapshot)
    .orderBy(desc(sql`sum(${transactions.totalAmount})`));
}

export async function getPaymentBreakdown(range: DateRange, client: DbClient = db) {
  const [row] = await client
    .select({
      cash: sql<number>`coalesce(sum(${transactions.cashAmount}), 0)::int`,
      upi: sql<number>`coalesce(sum(${transactions.upiAmount}), 0)::int`,
      cashOnlyCount: sql<number>`count(*) filter (where ${transactions.paymentMethod} = 'CASH')::int`,
      upiOnlyCount: sql<number>`count(*) filter (where ${transactions.paymentMethod} = 'UPI')::int`,
      splitCount: sql<number>`count(*) filter (where ${transactions.paymentMethod} = 'SPLIT')::int`,
      splitCash: sql<number>`coalesce(sum(${transactions.cashAmount}) filter (where ${transactions.paymentMethod} = 'SPLIT'), 0)::int`,
      splitUpi: sql<number>`coalesce(sum(${transactions.upiAmount}) filter (where ${transactions.paymentMethod} = 'SPLIT'), 0)::int`,
    })
    .from(transactions)
    .where(completedIn(range));
  return (
    row ?? { cash: 0, upi: 0, cashOnlyCount: 0, upiOnlyCount: 0, splitCount: 0, splitCash: 0, splitUpi: 0 }
  );
}

/** Revenue bucketed by local hour — drives the "peak hours" chart. */
export async function getHourlyRevenue(range: DateRange, client: DbClient = db) {
  const settings = await getSettings();
  const rows = await client
    .select({
      hour: sql<number>`extract(hour from (${transactions.createdAt} at time zone ${settings.timezone}))::int`,
      total: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(completedIn(range))
    // Group/order by output position: repeating the expression would bind the
    // timezone as a second placeholder and Postgres would not match the two.
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    total: byHour.get(hour)?.total ?? 0,
    sessions: byHour.get(hour)?.sessions ?? 0,
  }));
}

/** Revenue per local calendar day across the range. */
export async function getDailyRevenue(range: DateRange, client: DbClient = db) {
  const settings = await getSettings();
  const rows = await client
    .select({
      day: sql<string>`to_char((${transactions.createdAt} at time zone ${settings.timezone})::date, 'YYYY-MM-DD')`,
      gaming: sql<number>`coalesce(sum(${transactions.gamingAmount}), 0)::int`,
      food: sql<number>`coalesce(sum(${transactions.foodAmount}), 0)::int`,
      total: sql<number>`coalesce(sum(${transactions.totalAmount}), 0)::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(completedIn(range))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  // Fill gaps so the chart has a continuous x-axis.
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out: { day: string; label: string; gaming: number; food: number; total: number; sessions: number }[] = [];
  let cursor = range.from;
  let guard = 0;
  while (cursor < range.to && guard < 400) {
    const key = toDateKey(cursor, settings.timezone);
    const found = byDay.get(key);
    out.push({
      day: key,
      label: key.slice(5),
      gaming: found?.gaming ?? 0,
      food: found?.food ?? 0,
      total: found?.total ?? 0,
      sessions: found?.sessions ?? 0,
    });
    cursor = addDaysInZone(cursor, 1, settings.timezone);
    guard += 1;
  }
  return out;
}

export async function getFoodSales(range: DateRange, client: DbClient = db) {
  return client
    .select({
      name: foodOrderItems.nameSnapshot,
      quantity: sql<number>`coalesce(sum(${foodOrderItems.quantity}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${foodOrderItems.lineTotal}), 0)::int`,
      orders: sql<number>`count(distinct ${foodOrders.id})::int`,
    })
    .from(foodOrderItems)
    .innerJoin(foodOrders, eq(foodOrderItems.orderId, foodOrders.id))
    .innerJoin(transactions, eq(transactions.sessionId, foodOrders.sessionId))
    .where(and(completedIn(range), ne(foodOrders.status, "CANCELLED")))
    .groupBy(foodOrderItems.nameSnapshot)
    .orderBy(desc(sql`sum(${foodOrderItems.lineTotal})`))
    .limit(50);
}

export async function getMembershipSales(range: DateRange, client: DbClient = db) {
  const [row] = await client
    .select({
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${memberships.price}), 0)::int`,
    })
    .from(memberships)
    .where(and(gte(memberships.createdAt, range.from), lt(memberships.createdAt, range.to)));
  return row ?? { count: 0, revenue: 0 };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData() {
  const settings = await getSettings();
  const range = await resolveRange("today");

  const [totals, stationCounts, liveSessions, hourly, membershipStats, topStations] = await Promise.all([
    getIncomeTotals(range),
    db
      .select({
        status: stations.status,
        count: sql<number>`count(*)::int`,
      })
      .from(stations)
      .where(eq(stations.isActive, true))
      .groupBy(stations.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(gameSessions)
      .where(inArray(gameSessions.status, ["ACTIVE", "PAUSED"])),
    getHourlyRevenue(range),
    (async () => {
      const now = new Date();
      const latest = db
        .select({
          memberId: memberships.memberId,
          endDate: sql<Date>`max(${memberships.endDate})`.as("end_date"),
        })
        .from(memberships)
        .groupBy(memberships.memberId)
        .as("latest");
      const warning = new Date(now.getTime() + settings.membershipExpiryWarningDays * 86_400_000);
      const [row] = await db
        .select({
          active: sql<number>`count(*) filter (where ${latest.endDate} > ${now})::int`,
          expiring: sql<number>`count(*) filter (where ${latest.endDate} > ${now} and ${latest.endDate} <= ${warning})::int`,
        })
        .from(latest);
      return row ?? { active: 0, expiring: 0 };
    })(),
    getStationIncome(range),
  ]);

  const statusMap = new Map(stationCounts.map((row) => [row.status, row.count]));
  const totalStations = stationCounts.reduce((sum, row) => sum + row.count, 0);

  return {
    range,
    totals,
    stations: {
      total: totalStations,
      available: statusMap.get("AVAILABLE") ?? 0,
      occupied: statusMap.get("OCCUPIED") ?? 0,
      reserved: statusMap.get("RESERVED") ?? 0,
      maintenance: statusMap.get("MAINTENANCE") ?? 0,
    },
    activeSessions: liveSessions[0]?.count ?? 0,
    hourly,
    members: membershipStats,
    warningDays: settings.membershipExpiryWarningDays,
    topStations: topStations.slice(0, 5),
    currencySymbol: settings.currencySymbol,
  };
}

/* -------------------------------------------------------------------------- */
/* Transactions list                                                          */
/* -------------------------------------------------------------------------- */

export type TransactionFilters = {
  search?: string;
  paymentMethod?: "ALL" | "CASH" | "UPI" | "SPLIT";
  stationId?: string;
  status?: "ALL" | "COMPLETED" | "VOID" | "REFUNDED";
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export async function listTransactions(filters: TransactionFilters) {
  const settings = await getSettings();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));

  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(transactions.createdAt, fromDateKey(filters.from, settings.timezone)));
  if (filters.to) {
    conditions.push(lte(transactions.createdAt, addDaysInZone(fromDateKey(filters.to, settings.timezone), 1, settings.timezone)));
  }
  if (filters.paymentMethod && filters.paymentMethod !== "ALL") {
    conditions.push(eq(transactions.paymentMethod, filters.paymentMethod));
  }
  if (filters.status && filters.status !== "ALL") {
    conditions.push(eq(transactions.status, filters.status));
  }
  if (filters.stationId) conditions.push(eq(transactions.stationId, filters.stationId));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        sql`${transactions.code} ilike ${term}`,
        sql`coalesce(${transactions.customerName}, '') ilike ${term}`,
        sql`coalesce(${transactions.customerMobile}, '') ilike ${term}`,
        sql`${transactions.stationSnapshot} ilike ${term}`,
      )!,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: transactions.id,
        code: transactions.code,
        createdAt: transactions.createdAt,
        customerName: transactions.customerName,
        customerType: transactions.customerType,
        station: transactions.stationSnapshot,
        category: transactions.categorySnapshot,
        gamingAmount: transactions.gamingAmount,
        foodAmount: transactions.foodAmount,
        discountAmount: transactions.discountAmount,
        totalAmount: transactions.totalAmount,
        cashAmount: transactions.cashAmount,
        upiAmount: transactions.upiAmount,
        paymentMethod: transactions.paymentMethod,
        status: transactions.status,
        billedMinutes: transactions.billedMinutes,
        staffName: users.name,
      })
      .from(transactions)
      .innerJoin(users, eq(transactions.staffId, users.id))
      .where(where)
      .orderBy(desc(transactions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(transactions).where(where),
  ]);

  return {
    rows,
    page,
    pageSize,
    total: totalRow?.value ?? 0,
    pageCount: Math.max(1, Math.ceil((totalRow?.value ?? 0) / pageSize)),
    currencySymbol: settings.currencySymbol,
  };
}

/** Every transaction in a range — used by the CSV exports. */
export async function listTransactionsForExport(range: DateRange) {
  return db
    .select({
      code: transactions.code,
      createdAt: transactions.createdAt,
      station: transactions.stationSnapshot,
      category: transactions.categorySnapshot,
      customerName: transactions.customerName,
      customerType: transactions.customerType,
      billedMinutes: transactions.billedMinutes,
      gamingAmount: transactions.gamingAmount,
      foodAmount: transactions.foodAmount,
      taxAmount: transactions.taxAmount,
      discountAmount: transactions.discountAmount,
      totalAmount: transactions.totalAmount,
      paymentMethod: transactions.paymentMethod,
      cashAmount: transactions.cashAmount,
      upiAmount: transactions.upiAmount,
      status: transactions.status,
      staffName: users.name,
    })
    .from(transactions)
    .innerJoin(users, eq(transactions.staffId, users.id))
    .where(and(gte(transactions.createdAt, range.from), lt(transactions.createdAt, range.to)))
    .orderBy(asc(transactions.createdAt));
}

/** Completed session history (including sessions that were cancelled). */
export async function listSessionHistory(range: DateRange, limit = 200) {
  return db
    .select({
      id: gameSessions.id,
      code: gameSessions.code,
      station: stations.code,
      customerName: gameSessions.customerName,
      customerType: gameSessions.customerType,
      memberName: members.fullName,
      startedAt: gameSessions.startedAt,
      endedAt: gameSessions.endedAt,
      status: gameSessions.status,
      pausedSeconds: gameSessions.pausedSeconds,
      transactionCode: transactions.code,
      total: transactions.totalAmount,
      paymentMethod: transactions.paymentMethod,
      staffName: users.name,
    })
    .from(gameSessions)
    .innerJoin(stations, eq(gameSessions.stationId, stations.id))
    .leftJoin(members, eq(gameSessions.memberId, members.id))
    .leftJoin(transactions, eq(transactions.sessionId, gameSessions.id))
    .leftJoin(users, eq(gameSessions.startedById, users.id))
    .where(and(gte(gameSessions.startedAt, range.from), lt(gameSessions.startedAt, range.to)))
    .orderBy(desc(gameSessions.startedAt))
    .limit(limit);
}
