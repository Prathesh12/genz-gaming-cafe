import "server-only";

import { and, asc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import { reservations, stationCategories, stations } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { ConflictError, NotFoundError } from "@/lib/errors";

export type ReservationInput = {
  id?: string;
  stationId: string;
  customerName: string;
  mobile: string | null;
  startTime: Date;
  endTime: Date;
  notes: string | null;
};

/**
 * Create or update a booking, refusing any overlap on the same station.
 * The overlap test is `existing.start < new.end AND existing.end > new.start`,
 * evaluated inside a transaction that locks the station row so two
 * simultaneous bookings cannot both pass.
 */
export async function upsertReservation(input: ReservationInput, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [station] = await tx.select().from(stations).where(eq(stations.id, input.stationId)).limit(1).for("update");
    if (!station || !station.isActive) throw new NotFoundError("Station not found.");
    if (station.status === "MAINTENANCE") {
      throw new ConflictError(`${station.code} is under maintenance and cannot be reserved.`);
    }
    if (input.endTime <= input.startTime) {
      throw new ConflictError("The end time must be after the start time.");
    }

    const clash = await tx
      .select({ id: reservations.id, customerName: reservations.customerName, startTime: reservations.startTime })
      .from(reservations)
      .where(
        and(
          eq(reservations.stationId, input.stationId),
          inArray(reservations.status, ["BOOKED", "STARTED"]),
          input.id ? ne(reservations.id, input.id) : sql`true`,
          lt(reservations.startTime, input.endTime),
          sql`${reservations.endTime} > ${input.startTime}`,
        ),
      )
      .limit(1);

    if (clash.length > 0) {
      throw new ConflictError(
        `${station.code} is already booked for ${clash[0].customerName} at that time.`,
      );
    }

    if (input.id) {
      const [row] = await tx
        .update(reservations)
        .set({
          stationId: input.stationId,
          customerName: input.customerName,
          mobile: input.mobile,
          startTime: input.startTime,
          endTime: input.endTime,
          notes: input.notes,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, input.id))
        .returning();
      if (!row) throw new NotFoundError("Reservation not found.");
      await recordAudit(
        {
          action: "reservation.updated",
          userId: user.id,
          userLabel: user.name,
          entityType: "reservation",
          entityId: row.id,
          metadata: { station: station.code, customer: row.customerName },
        },
        tx,
      );
      return row;
    }

    const [row] = await tx
      .insert(reservations)
      .values({
        stationId: input.stationId,
        customerName: input.customerName,
        mobile: input.mobile,
        startTime: input.startTime,
        endTime: input.endTime,
        notes: input.notes,
        createdById: user.id,
      })
      .returning();

    // Reflect the booking on the board when the station is otherwise idle.
    if (station.status === "AVAILABLE") {
      await tx.update(stations).set({ status: "RESERVED", updatedAt: new Date() }).where(eq(stations.id, station.id));
    }

    await recordAudit(
      {
        action: "reservation.created",
        userId: user.id,
        userLabel: user.name,
        entityType: "reservation",
        entityId: row.id,
        metadata: { station: station.code, customer: row.customerName, start: input.startTime.toISOString() },
      },
      tx,
    );
    return row;
  });
}

export async function cancelReservation(id: string, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(reservations).where(eq(reservations.id, id)).limit(1);
    if (!row) throw new NotFoundError("Reservation not found.");
    if (row.status === "STARTED") throw new ConflictError("That booking has already started.");

    await tx
      .update(reservations)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(reservations.id, id));

    const [remaining] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reservations)
      .where(
        and(
          eq(reservations.stationId, row.stationId),
          eq(reservations.status, "BOOKED"),
          gte(reservations.endTime, new Date()),
        ),
      );

    if (!remaining || remaining.count === 0) {
      await tx
        .update(stations)
        .set({ status: "AVAILABLE", updatedAt: new Date() })
        .where(and(eq(stations.id, row.stationId), eq(stations.status, "RESERVED")));
    }

    await recordAudit(
      {
        action: "reservation.cancelled",
        userId: user.id,
        userLabel: user.name,
        entityType: "reservation",
        entityId: id,
        metadata: { customer: row.customerName },
      },
      tx,
    );
  });
}

export async function markNoShow(id: string, user: SessionUser) {
  const [row] = await db
    .update(reservations)
    .set({ status: "NO_SHOW", updatedAt: new Date() })
    .where(eq(reservations.id, id))
    .returning();
  if (!row) throw new NotFoundError("Reservation not found.");
  await recordAudit({
    action: "reservation.updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "reservation",
    entityId: id,
    metadata: { status: "NO_SHOW" },
  });
}

export async function listReservations(scope: "upcoming" | "all" = "upcoming", client: DbClient = db) {
  const now = new Date();
  return client
    .select({
      id: reservations.id,
      stationId: reservations.stationId,
      stationCode: stations.code,
      stationName: stations.name,
      categoryName: stationCategories.name,
      customerName: reservations.customerName,
      mobile: reservations.mobile,
      startTime: reservations.startTime,
      endTime: reservations.endTime,
      notes: reservations.notes,
      status: reservations.status,
      createdAt: reservations.createdAt,
    })
    .from(reservations)
    .innerJoin(stations, eq(reservations.stationId, stations.id))
    .innerJoin(stationCategories, eq(stations.categoryId, stationCategories.id))
    .where(
      scope === "upcoming"
        ? and(
            or(gte(reservations.endTime, now), eq(reservations.status, "STARTED")),
            inArray(reservations.status, ["BOOKED", "STARTED"]),
          )
        : sql`true`,
    )
    .orderBy(asc(reservations.startTime))
    .limit(200);
}
