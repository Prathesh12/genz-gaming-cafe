import "server-only";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import {
  foodOrderItems,
  foodOrders,
  gameSessions,
  members,
  memberships,
  reservations,
  sessionExtensions,
  sessionPauses,
  sessionPlayers,
  stationCategories,
  stations,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { sessionCode } from "@/lib/codes";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { activeCoverage } from "@/lib/memberships";
import type {
  EnginePlayer,
  EnginePricingRule,
  PauseInterval,
  PriceSessionPlayersResult,
  RoomPricingSnapshot,
} from "@/server/pricing/engine";
import { computeGroupGamingCharge, computeRoomGamingCharge, getRulesByCategory } from "@/server/services/pricing";
import { getSettingsFor } from "@/server/services/settings";

/** One seat on the station: a member, or a guest paying regular rates. */
export type SessionPlayerInput = {
  memberId: string | null;
  /** Optional name for a guest. Members always use their own name. */
  name: string | null;
};

export type StartSessionInput = {
  stationId: string;
  customerName: string | null;
  customerMobile: string | null;
  memberId: string | null;
  plannedMinutes: number | null;
  notes: string | null;
  reservationId: string | null;
  /**
   * Everyone playing. Omitted for an ordinary one-seat station, where the
   * `memberId` / `customerName` fields above describe the single player.
   */
  players?: SessionPlayerInput[];
};

/** A player resolved against the database, ready to be written and priced. */
type ResolvedPlayer = {
  slot: number;
  memberId: string | null;
  membershipId: string | null;
  customerType: "REGULAR" | "MEMBER";
  name: string | null;
  mobile: string | null;
  membershipValidUntil: Date | null;
};

/**
 * Turn the counter's picks into priced players.
 *
 * Membership is resolved once, here, at the moment the player is added — the
 * result is stored as a snapshot so renewing or cancelling a membership later
 * can never rewrite a bill that has already been taken.
 */
async function resolvePlayers(
  tx: DbClient,
  input: SessionPlayerInput[],
  at: Date,
): Promise<ResolvedPlayer[]> {
  const memberIds = input.map((player) => player.memberId).filter((id): id is string => Boolean(id));
  if (new Set(memberIds).size !== memberIds.length) {
    throw new ValidationError("The same member is listed twice. Each player must be a different person.");
  }

  const resolved: ResolvedPlayer[] = [];

  for (const [index, entry] of input.entries()) {
    const slot = index + 1;

    if (!entry.memberId) {
      resolved.push({
        slot,
        memberId: null,
        membershipId: null,
        customerType: "REGULAR",
        name: entry.name?.trim() || null,
        mobile: null,
        membershipValidUntil: null,
      });
      continue;
    }

    const [member] = await tx.select().from(members).where(eq(members.id, entry.memberId)).limit(1);
    if (!member || !member.isActive) throw new NotFoundError("One of the selected members no longer exists.");

    /**
     * Every term this member holds, not just the one with the latest end date.
     * A renewal bought early starts on the day the current term ends, so the
     * latest row is often one that has not begun — reading only that row
     * charged paid-up members full price. `activeCoverage` picks the term that
     * covers this moment and follows the stack to the end of unbroken cover.
     */
    const terms = await tx
      .select({ id: memberships.id, startDate: memberships.startDate, endDate: memberships.endDate })
      .from(memberships)
      .where(eq(memberships.memberId, member.id));

    const coverage = activeCoverage(terms, at);

    resolved.push({
      slot,
      memberId: member.id,
      membershipId: coverage?.term.id ?? null,
      // A lapsed membership is not an error: that player simply pays the
      // regular rate, exactly as the counter sees on screen before starting.
      customerType: coverage ? "MEMBER" : "REGULAR",
      name: entry.name?.trim() || member.fullName,
      mobile: member.mobile,
      membershipValidUntil: coverage?.validUntil ?? null,
    });
  }

  return resolved;
}

/**
 * Start a session.
 *
 * Concurrency: the station row is locked FOR UPDATE, so two staff devices
 * tapping START at the same instant serialise here; the second one sees the
 * live session and gets a clear error. A partial unique index on
 * (station_id) WHERE status IN ('ACTIVE','PAUSED') is the database-level
 * backstop if that lock is ever bypassed.
 */
export async function startSession(input: StartSessionInput, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [station] = await tx.select().from(stations).where(eq(stations.id, input.stationId)).limit(1).for("update");

    if (!station || !station.isActive) throw new NotFoundError("That station no longer exists.");
    if (station.status === "MAINTENANCE") {
      throw new ConflictError(
        `${station.code} is under maintenance${station.maintenanceReason ? ` (${station.maintenanceReason})` : ""}. Return it to available first.`,
      );
    }

    const [live] = await tx
      .select({ id: gameSessions.id, code: gameSessions.code })
      .from(gameSessions)
      .where(and(eq(gameSessions.stationId, station.id), inArray(gameSessions.status, ["ACTIVE", "PAUSED"])))
      .limit(1);
    if (live) {
      throw new ConflictError(`${station.code} already has a live session (${live.code}).`);
    }

    const startedAt = new Date();

    /**
     * One seat or several. A station whose category seats one person sends no
     * player list, so the single member / walk-in fields describe player 1 and
     * everything downstream behaves as it always has.
     */
    const requested: SessionPlayerInput[] =
      input.players && input.players.length > 0
        ? input.players
        : [{ memberId: input.memberId, name: input.customerName }];

    const [category] = await tx
      .select({
        maxPlayers: stationCategories.maxPlayers,
        name: stationCategories.name,
        pricingModel: stationCategories.pricingModel,
        playstationType: stationCategories.playstationType,
      })
      .from(stationCategories)
      .where(eq(stationCategories.id, station.categoryId))
      .limit(1);
    const maxPlayers = category?.maxPlayers ?? 1;

    if (requested.length > maxPlayers) {
      throw new ValidationError(
        `${category?.name ?? "This station"} seats ${maxPlayers} ${maxPlayers === 1 ? "player" : "players"}. Raise the limit in Stations > Manage to book more.`,
      );
    }

    if (category?.pricingModel === "ROOM" && (requested.length < 1 || requested.length > 4)) {
      throw new ValidationError("A PlayStation room session requires between 1 and 4 players.");
    }

    const roster = await resolvePlayers(tx, requested, startedAt);
    const primary = roster[0];
    let pricingSnapshot: RoomPricingSnapshot | null = null;

    if (category?.pricingModel === "ROOM") {
      const rules = (await getRulesByCategory(tx)).get(station.categoryId) ?? [];
      const applicableRules = rules
        .filter((rule) => (rule.playerCount ?? 1) === roster.length)
        .map((rule) => ({ ...rule }));
      const settings = await getSettingsFor(tx);
      computeRoomGamingCharge({
        startedAt,
        endedAt: new Date(startedAt.getTime() + 60 * 60_000),
        pauses: [],
        playerCount: roster.length,
        rules: applicableRules,
        settings,
      });
      pricingSnapshot = { pricingModel: "ROOM", playerCount: roster.length, rules: applicableRules };
    }

    const [session] = await tx
      .insert(gameSessions)
      .values({
        code: sessionCode(startedAt),
        stationId: station.id,
        // The columns below describe player 1; the full roster lives in
        // session_players and is what the bill is actually built from.
        memberId: primary.memberId,
        membershipId: primary.membershipId,
        customerName: primary.name ?? input.customerName,
        customerMobile: input.customerMobile ?? primary.mobile,
        customerType: primary.customerType,
        playerCount: roster.length,
        pricingModel: category?.pricingModel ?? "PER_PLAYER",
        pricingSnapshot,
        status: "ACTIVE",
        startedAt,
        plannedMinutes: input.plannedMinutes,
        notes: input.notes,
        startedById: user.id,
        reservationId: input.reservationId,
      })
      .returning();

    await tx.insert(sessionPlayers).values(
      roster.map((player) => ({
        sessionId: session.id,
        slot: player.slot,
        memberId: player.memberId,
        membershipId: player.membershipId,
        customerType: player.customerType,
        name: player.name,
        membershipValidUntil: player.membershipValidUntil,
      })),
    );

    await tx.update(stations).set({ status: "OCCUPIED", updatedAt: new Date() }).where(eq(stations.id, station.id));

    if (input.reservationId) {
      await tx
        .update(reservations)
        .set({ status: "STARTED", updatedAt: new Date() })
        .where(eq(reservations.id, input.reservationId));
    }

    await recordAudit(
      {
        action: "session.started",
        userId: user.id,
        userLabel: user.name,
        entityType: "session",
        entityId: session.id,
        metadata: {
          station: station.code,
          customerType: primary.customerType,
          sessionCode: session.code,
          playerCount: roster.length,
          members: roster.filter((player) => player.customerType === "MEMBER").length,
        },
      },
      tx,
    );

    return session;
  });
}

/**
 * Correct the roster of a session that is already running — somebody joined
 * late, or the counter picked the wrong member.
 *
 * Everyone on the list is billed for the whole session; there is no per-player
 * clock. That is stated plainly in the dialog so it can never be a surprise on
 * the bill.
 */
export async function setSessionPlayers(
  sessionId: string,
  players: SessionPlayerInput[],
  user: SessionUser,
) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1).for("update");
    if (!session) throw new NotFoundError("Session not found.");
    if (session.status === "COMPLETED") throw new ConflictError("This session has already been paid for.");
    if (session.status === "CANCELLED") throw new ConflictError("This session was cancelled.");
    if (session.pricingModel === "ROOM") {
      throw new ConflictError("Player count is locked for a PlayStation room session. Start a new session to change it.");
    }
    if (players.length === 0) throw new ValidationError("A session needs at least one player.");

    const [row] = await tx
      .select({ maxPlayers: stationCategories.maxPlayers, categoryName: stationCategories.name })
      .from(stations)
      .innerJoin(stationCategories, eq(stations.categoryId, stationCategories.id))
      .where(eq(stations.id, session.stationId))
      .limit(1);
    const maxPlayers = row?.maxPlayers ?? 1;

    if (players.length > maxPlayers) {
      throw new ValidationError(
        `${row?.categoryName ?? "This station"} seats ${maxPlayers} ${maxPlayers === 1 ? "player" : "players"}.`,
      );
    }

    // Membership is resolved as of the session start, so a player added later
    // is priced on the same footing as everyone who was there from the off.
    const roster = await resolvePlayers(tx, players, session.startedAt);
    const primary = roster[0];

    await tx.delete(sessionPlayers).where(eq(sessionPlayers.sessionId, sessionId));
    await tx.insert(sessionPlayers).values(
      roster.map((player) => ({
        sessionId,
        slot: player.slot,
        memberId: player.memberId,
        membershipId: player.membershipId,
        customerType: player.customerType,
        name: player.name,
        membershipValidUntil: player.membershipValidUntil,
      })),
    );

    await tx
      .update(gameSessions)
      .set({
        memberId: primary.memberId,
        membershipId: primary.membershipId,
        customerName: primary.name ?? session.customerName,
        customerType: primary.customerType,
        playerCount: roster.length,
        updatedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId));

    await recordAudit(
      {
        action: "session.players_updated",
        userId: user.id,
        userLabel: user.name,
        entityType: "session",
        entityId: sessionId,
        metadata: {
          sessionCode: session.code,
          from: session.playerCount,
          to: roster.length,
          members: roster.filter((player) => player.customerType === "MEMBER").length,
        },
      },
      tx,
    );
  });
}

export type SessionRosterRow = {
  slot: number;
  memberId: string | null;
  memberCode: string | null;
  name: string | null;
  customerType: "REGULAR" | "MEMBER";
  membershipValidUntil: Date | null;
};

/** The people on a station right now, in seat order. */
export async function getSessionRoster(
  sessionId: string,
  client: DbClient = db,
): Promise<SessionRosterRow[]> {
  return client
    .select({
      slot: sessionPlayers.slot,
      memberId: sessionPlayers.memberId,
      memberCode: members.memberCode,
      name: sessionPlayers.name,
      customerType: sessionPlayers.customerType,
      membershipValidUntil: sessionPlayers.membershipValidUntil,
    })
    .from(sessionPlayers)
    .leftJoin(members, eq(sessionPlayers.memberId, members.id))
    .where(eq(sessionPlayers.sessionId, sessionId))
    .orderBy(asc(sessionPlayers.slot));
}

export async function pauseSession(sessionId: string, user: SessionUser, reason: string | null) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1).for("update");
    if (!session) throw new NotFoundError("Session not found.");
    if (session.status !== "ACTIVE") throw new ConflictError("Only a running session can be paused.");
    if (session.endedAt) throw new ConflictError("This session is already at checkout. Resume billing first.");

    await tx.insert(sessionPauses).values({ sessionId, pausedAt: new Date(), reason });
    await tx.update(gameSessions).set({ status: "PAUSED", updatedAt: new Date() }).where(eq(gameSessions.id, sessionId));

    await recordAudit(
      { action: "session.paused", userId: user.id, userLabel: user.name, entityType: "session", entityId: sessionId },
      tx,
    );
  });
}

export async function resumeSession(sessionId: string, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1).for("update");
    if (!session) throw new NotFoundError("Session not found.");
    if (session.status !== "PAUSED") throw new ConflictError("This session is not paused.");

    const [open] = await tx
      .select()
      .from(sessionPauses)
      .where(and(eq(sessionPauses.sessionId, sessionId), isNull(sessionPauses.resumedAt)))
      .limit(1);

    const now = new Date();
    let addedSeconds = 0;
    if (open) {
      addedSeconds = Math.max(0, Math.floor((now.getTime() - open.pausedAt.getTime()) / 1000));
      await tx.update(sessionPauses).set({ resumedAt: now }).where(eq(sessionPauses.id, open.id));
    }

    await tx
      .update(gameSessions)
      .set({
        status: "ACTIVE",
        pausedSeconds: sql`${gameSessions.pausedSeconds} + ${addedSeconds}`,
        updatedAt: now,
      })
      .where(eq(gameSessions.id, sessionId));

    await recordAudit(
      {
        action: "session.resumed",
        userId: user.id,
        userLabel: user.name,
        entityType: "session",
        entityId: sessionId,
        metadata: { pausedSeconds: addedSeconds },
      },
      tx,
    );
  });
}

export async function addSessionTime(sessionId: string, minutes: number, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1).for("update");
    if (!session) throw new NotFoundError("Session not found.");
    if (session.status === "COMPLETED" || session.status === "CANCELLED") {
      throw new ConflictError("This session has already been closed.");
    }

    await tx.insert(sessionExtensions).values({ sessionId, minutes, createdById: user.id });
    await tx
      .update(gameSessions)
      .set({
        plannedMinutes: sql`coalesce(${gameSessions.plannedMinutes}, 0) + ${minutes}`,
        // Adding time to a session that was already at checkout puts it back
        // on the clock rather than creating a second session.
        endedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId));

    await recordAudit(
      {
        action: "session.extended",
        userId: user.id,
        userLabel: user.name,
        entityType: "session",
        entityId: sessionId,
        metadata: { minutes },
      },
      tx,
    );
  });
}

/**
 * Freeze the bill. The customer has stopped playing, so the clock stops, but
 * nothing is charged until payment is confirmed. Keeping this separate from
 * `completeCheckout` means the totals a staff member sees cannot drift while
 * they count cash.
 */
export async function stopBilling(sessionId: string) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1).for("update");
    if (!session) throw new NotFoundError("Session not found.");
    if (session.status === "COMPLETED") throw new ConflictError("This session has already been paid.");
    if (session.status === "CANCELLED") throw new ConflictError("This session was cancelled.");
    if (session.endedAt) return session; // already frozen — idempotent

    const now = new Date();
    // Close any open pause so the paused total is accurate.
    const [open] = await tx
      .select()
      .from(sessionPauses)
      .where(and(eq(sessionPauses.sessionId, sessionId), isNull(sessionPauses.resumedAt)))
      .limit(1);
    let addedSeconds = 0;
    if (open) {
      addedSeconds = Math.max(0, Math.floor((now.getTime() - open.pausedAt.getTime()) / 1000));
      await tx.update(sessionPauses).set({ resumedAt: now }).where(eq(sessionPauses.id, open.id));
    }

    const [updated] = await tx
      .update(gameSessions)
      .set({
        endedAt: now,
        status: "ACTIVE",
        pausedSeconds: sql`${gameSessions.pausedSeconds} + ${addedSeconds}`,
        updatedAt: now,
      })
      .where(eq(gameSessions.id, sessionId))
      .returning();

    return updated;
  });
}

/** Undo `stopBilling` — the customer decided to keep playing. */
export async function resumeBilling(sessionId: string) {
  const [session] = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1);
  if (!session) throw new NotFoundError("Session not found.");
  if (session.status === "COMPLETED") throw new ConflictError("This session has already been paid.");
  await db.update(gameSessions).set({ endedAt: null, updatedAt: new Date() }).where(eq(gameSessions.id, sessionId));
}

export async function cancelSession(sessionId: string, reason: string | null, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).limit(1).for("update");
    if (!session) throw new NotFoundError("Session not found.");
    if (session.status === "COMPLETED") throw new ConflictError("A paid session cannot be cancelled.");

    const [food] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(foodOrders)
      .where(and(eq(foodOrders.sessionId, sessionId), ne(foodOrders.status, "CANCELLED")));
    if (food && food.count > 0) {
      throw new ConflictError(
        "This session has food orders. Cancel the food orders first, or take payment instead.",
      );
    }

    const now = new Date();
    await tx
      .update(gameSessions)
      .set({ status: "CANCELLED", endedAt: now, endedById: user.id, updatedAt: now, notes: reason ?? session.notes })
      .where(eq(gameSessions.id, sessionId));
    await tx.update(stations).set({ status: "AVAILABLE", updatedAt: now }).where(eq(stations.id, session.stationId));

    await recordAudit(
      {
        action: "session.cancelled",
        userId: user.id,
        userLabel: user.name,
        entityType: "session",
        entityId: sessionId,
        metadata: { reason, sessionCode: session.code },
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export type SessionBill = {
  session: {
    id: string;
    code: string;
    startedAt: Date;
    endedAt: Date | null;
    billingEndsAt: Date;
    status: string;
    customerName: string | null;
    customerMobile: string | null;
    customerType: "REGULAR" | "MEMBER";
    memberName: string | null;
    memberCode: string | null;
    membershipValidUntil: Date | null;
    plannedMinutes: number | null;
    playerCount: number;
    pricingModel: "PER_PLAYER" | "ROOM";
  };
  station: {
    id: string;
    code: string;
    name: string;
    categoryId: string;
    categoryName: string;
    maxPlayers: number;
    playstationType: "PS4" | "PS5" | null;
  };
  /** Everyone on the station, with each player's own share of the gaming charge. */
  players: {
    slot: number;
    label: string;
    memberId: string | null;
    memberCode: string | null;
    customerType: "REGULAR" | "MEMBER";
    amount: number;
  }[];
  gaming: PriceSessionPlayersResult;
  food: {
    lines: {
      orderId: string;
      orderCode: string;
      status: string;
      name: string;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      taxAmount: number;
    }[];
    amount: number;
    taxAmount: number;
  };
  subtotal: number;
  taxEnabled: boolean;
  currencySymbol: string;
};

/**
 * Everything needed to render a checkout screen or a live session panel.
 * Uses the frozen `endedAt` when the bill has been stopped, otherwise now.
 */
export async function getSessionBill(
  sessionId: string,
  client: DbClient = db,
  forceDayPass = false,
): Promise<SessionBill> {
  const settings = await getSettingsFor(client);

  const [row] = await client
    .select({
      session: gameSessions,
      station: {
        id: stations.id,
        code: stations.code,
        name: stations.name,
        categoryId: stations.categoryId,
      },
      categoryName: stationCategories.name,
      maxPlayers: stationCategories.maxPlayers,
      playstationType: stationCategories.playstationType,
      memberName: members.fullName,
      memberCode: members.memberCode,
      membershipValidUntil: memberships.endDate,
    })
    .from(gameSessions)
    .innerJoin(stations, eq(gameSessions.stationId, stations.id))
    .innerJoin(stationCategories, eq(stations.categoryId, stationCategories.id))
    .leftJoin(members, eq(gameSessions.memberId, members.id))
    .leftJoin(memberships, eq(gameSessions.membershipId, memberships.id))
    .where(eq(gameSessions.id, sessionId))
    .limit(1);

  if (!row) throw new NotFoundError("Session not found.");

  const pauses = await client
    .select()
    .from(sessionPauses)
    .where(eq(sessionPauses.sessionId, sessionId))
    .orderBy(asc(sessionPauses.pausedAt));

  const foodRows = await client
    .select({
      orderId: foodOrders.id,
      orderCode: foodOrders.code,
      status: foodOrders.status,
      name: foodOrderItems.nameSnapshot,
      quantity: foodOrderItems.quantity,
      unitPrice: foodOrderItems.unitPrice,
      lineTotal: foodOrderItems.lineTotal,
      taxAmount: foodOrderItems.taxAmount,
    })
    .from(foodOrders)
    .innerJoin(foodOrderItems, eq(foodOrderItems.orderId, foodOrders.id))
    .where(and(eq(foodOrders.sessionId, sessionId), ne(foodOrders.status, "CANCELLED")))
    .orderBy(asc(foodOrders.createdAt));

  const rulesByCategory = await getRulesByCategory(client);
  const liveRules = rulesByCategory.get(row.station.categoryId) ?? [];

  const billingEndsAt = row.session.endedAt ?? new Date();
  const pauseIntervals: PauseInterval[] = pauses.map((p) => ({ pausedAt: p.pausedAt, resumedAt: p.resumedAt }));

  /**
   * The roster drives the price. A session started before multi-player billing
   * existed has no rows here, so fall back to the member columns on the session
   * itself — an old bill therefore prices exactly as it always did.
   */
  const roster = await getSessionRoster(sessionId, client);
  const enginePlayers: EnginePlayer[] = (
    roster.length > 0
      ? roster
      : [
          {
            slot: 1,
            memberId: row.session.memberId,
            memberCode: row.memberCode,
            name: row.session.customerName,
            customerType: row.session.customerType,
            membershipValidUntil: row.membershipValidUntil ?? null,
          },
        ]
  ).map((player) => ({
    slot: player.slot,
    label: player.name ?? `Player ${player.slot}`,
    customerType: player.customerType,
    membershipValidUntil: player.membershipValidUntil,
  }));

  const gaming = row.session.pricingModel === "ROOM"
    ? priceRoomFromSnapshot(row.session.pricingSnapshot, {
        startedAt: row.session.startedAt,
        endedAt: billingEndsAt,
        pauses: pauseIntervals,
        players: enginePlayers,
        settings,
        forceDayPass,
      })
    : computeGroupGamingCharge({
        startedAt: row.session.startedAt,
        endedAt: billingEndsAt,
        pauses: pauseIntervals,
        players: enginePlayers,
        rules: liveRules,
        settings,
        forceDayPass,
      });

  const foodAmount = foodRows.reduce((sum, line) => sum + line.lineTotal, 0);
  const foodTax = settings.taxEnabled ? foodRows.reduce((sum, line) => sum + line.taxAmount, 0) : 0;

  return {
    session: {
      id: row.session.id,
      code: row.session.code,
      startedAt: row.session.startedAt,
      endedAt: row.session.endedAt,
      billingEndsAt,
      status: row.session.status,
      customerName: row.session.customerName,
      customerMobile: row.session.customerMobile,
      customerType: row.session.customerType,
      memberName: row.memberName,
      memberCode: row.memberCode,
      membershipValidUntil: row.membershipValidUntil ?? null,
      plannedMinutes: row.session.plannedMinutes,
      playerCount: gaming.playerCount,
      pricingModel: row.session.pricingModel,
    },
    station: {
      ...row.station,
      categoryName: row.categoryName,
      maxPlayers: row.maxPlayers,
      playstationType: row.playstationType,
    },
    players: gaming.players.map((player) => {
      const source = roster.find((entry) => entry.slot === player.slot);
      return {
        slot: player.slot,
        label: player.label,
        memberId: source?.memberId ?? row.session.memberId,
        memberCode: source?.memberCode ?? row.memberCode,
        customerType: player.customerType,
        amount: player.amount,
      };
    }),
    gaming,
    food: { lines: foodRows, amount: foodAmount, taxAmount: foodTax },
    subtotal: gaming.amount + foodAmount + foodTax,
    taxEnabled: settings.taxEnabled,
    currencySymbol: settings.currencySymbol,
  };
}

function priceRoomFromSnapshot(
  value: unknown,
  input: {
    startedAt: Date;
    endedAt: Date;
    pauses: PauseInterval[];
    players: EnginePlayer[];
    settings: Awaited<ReturnType<typeof getSettingsFor>>;
    forceDayPass: boolean;
  },
): PriceSessionPlayersResult {
  const snapshot = value as Partial<RoomPricingSnapshot> | null;
  if (
    !snapshot ||
    snapshot.pricingModel !== "ROOM" ||
    !Number.isInteger(snapshot.playerCount) ||
    !Array.isArray(snapshot.rules)
  ) {
    throw new ValidationError("This room session has no valid pricing snapshot. Cancel it and start a new session.");
  }

  const rules = snapshot.rules as EnginePricingRule[];
  const room = computeRoomGamingCharge({
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    pauses: input.pauses,
    playerCount: snapshot.playerCount as number,
    rules,
    settings: input.settings,
    forceDayPass: input.forceDayPass,
  });
  const count = snapshot.playerCount as number;
  const base = Math.floor(room.amount / count);
  let remainder = room.amount - base * count;
  const players = Array.from({ length: count }, (_, index) => {
    const amount = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    const player = input.players[index];
    return {
      slot: index + 1,
      label: player?.label ?? `Player ${index + 1}`,
      customerType: player?.customerType ?? "REGULAR" as const,
      amount,
      segments: room.segments,
      dayPassApplied: room.dayPassApplied,
    };
  });

  return { ...room, playerCount: count, players };
}
