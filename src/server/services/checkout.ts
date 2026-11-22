import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  gameSessions,
  payments,
  reservations,
  sessionPauses,
  sessionPlayers,
  stations,
  transactions,
  users,
  type DiscountType,
  type PaymentMethod,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { computeDiscount, discountPercentOf, resolvePayment, splitBillAcrossPlayers } from "@/lib/billing";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { can, discountCeiling } from "@/lib/permissions";
import { getSessionBill } from "@/server/services/sessions";
import { nextInvoiceCode } from "@/server/services/settings";

export type CheckoutInput = {
  sessionId: string;
  discountType: DiscountType;
  /** Percent (0-100) or rupees; converted to paise by the schema for FLAT. */
  discountValue: number;
  discountReason: string | null;
  paymentMethod: PaymentMethod;
  /** Paise. */
  cashAmount: number;
  upiAmount: number;
  upiReference: string | null;
  forceDayPass: boolean;
  /** Manual gaming charge in paise, replacing the calculated one. */
  overrideGamingAmount?: number | null;
  overrideReason: string | null;
  /** Paise total the staff member saw on screen. */
  expectedTotal: number;
};

/**
 * Take payment and close the session.
 *
 * Everything below happens inside ONE database transaction: recalculating the
 * bill, writing the transaction, writing the payment rows, closing the session
 * and freeing the station. If any step fails, none of it is applied — a
 * station can never be freed without a recorded sale, and a sale can never be
 * recorded twice for one session (the unique index on transactions.session_id
 * guarantees that even under a double click or a duplicated request).
 */
export async function completeCheckout(input: CheckoutInput, user: SessionUser) {
  if (!can(user, "checkout.process")) {
    throw new ForbiddenError("Your role cannot take payments.");
  }

  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, input.sessionId))
      .limit(1)
      .for("update");

    if (!session) throw new NotFoundError("Session not found.");
    if (session.status === "COMPLETED") {
      throw new ConflictError("This session has already been paid for.");
    }
    if (session.status === "CANCELLED") {
      throw new ConflictError("This session was cancelled and cannot be billed.");
    }

    // Close any open pause so paused time is complete and the clock is frozen.
    const now = new Date();
    const [openPause] = await tx
      .select()
      .from(sessionPauses)
      .where(and(eq(sessionPauses.sessionId, session.id), isNull(sessionPauses.resumedAt)))
      .limit(1);
    if (openPause) {
      await tx.update(sessionPauses).set({ resumedAt: now }).where(eq(sessionPauses.id, openPause.id));
    }

    const endedAt = session.endedAt ?? now;
    if (!session.endedAt) {
      await tx.update(gameSessions).set({ endedAt }).where(eq(gameSessions.id, session.id));
    }

    // Authoritative recalculation — never trust amounts sent by the browser.
    const bill = await getSessionBill(session.id, tx, input.forceDayPass);

    /**
     * A manual gaming amount replaces what the pricing engine worked out. The
     * calculated figure is kept in the stored breakdown so the change is always
     * explainable, and the override is written to the audit log.
     */
    const calculatedGaming = bill.gaming.amount;
    let gamingAmount = calculatedGaming;
    let overrideApplied = false;

    if (input.overrideGamingAmount !== null && input.overrideGamingAmount !== undefined) {
      if (!can(user, "discount.apply")) {
        throw new ForbiddenError("You are not allowed to change the gaming amount.");
      }
      gamingAmount = Math.max(0, Math.round(input.overrideGamingAmount));
      overrideApplied = gamingAmount !== calculatedGaming;
    }

    const subtotal = gamingAmount + bill.food.amount + bill.food.taxAmount;

    const ceiling = discountCeiling(user);
    let discountAmount = computeDiscount(subtotal, input.discountType, input.discountValue);

    if (discountAmount > 0) {
      if (!can(user, "discount.apply")) {
        throw new ForbiddenError("You are not allowed to apply discounts.");
      }
      const effectivePercent = discountPercentOf(subtotal, discountAmount);
      if (effectivePercent > ceiling + 0.001) {
        throw new ForbiddenError(
          `Your discount limit is ${ceiling}%. Ask a manager to approve a larger discount.`,
        );
      }
    } else {
      discountAmount = 0;
    }

    const totalAmount = Math.max(0, subtotal - discountAmount);

    if (input.expectedTotal !== totalAmount) {
      throw new ConflictError(
        `The bill changed while you were on this screen (now ${formatMoney(totalAmount, bill.currencySymbol)}). Review the updated total and confirm again.`,
      );
    }

    // ---- Payment validation ------------------------------------------------
    const payment = resolvePayment(input.paymentMethod, totalAmount, input.cashAmount, input.upiAmount);
    if (!payment.valid) {
      throw new ValidationError(
        input.paymentMethod === "SPLIT"
          ? `${payment.reason} The bill is ${formatMoney(totalAmount, bill.currencySymbol)}.`
          : payment.reason,
      );
    }
    const { cashAmount, upiAmount } = payment;

    /**
     * What each player on the station actually paid: their own gaming charge
     * plus an equal share of the food, tax and discount the table shared. Kept
     * on `session_players` so a member's spend history stays accurate when four
     * people split one bill.
     */
    const playerShares = splitBillAcrossPlayers(
      bill.players.map((player) => player.amount),
      gamingAmount,
      bill.food.amount + bill.food.taxAmount - discountAmount,
      totalAmount,
    );

    const code = await nextInvoiceCode(tx, now);

    const [transaction] = await tx
      .insert(transactions)
      .values({
        code,
        sessionId: session.id,
        stationId: bill.station.id,
        stationSnapshot: `${bill.station.code} — ${bill.station.name}`,
        categorySnapshot: bill.station.categoryName,
        memberId: session.memberId,
        customerName: session.customerName,
        customerMobile: session.customerMobile,
        customerType: session.customerType,
        playerCount: bill.session.playerCount,
        startedAt: session.startedAt,
        endedAt,
        durationMinutes: bill.gaming.wallMinutes,
        billedMinutes: bill.gaming.billedMinutes,
        gamingAmount,
        foodAmount: bill.food.amount,
        taxAmount: bill.food.taxAmount,
        subtotal,
        discountType: discountAmount > 0 ? input.discountType : "NONE",
        discountValue: discountAmount > 0 ? Math.round(input.discountValue) : 0,
        discountAmount,
        discountReason: discountAmount > 0 ? input.discountReason : null,
        discountById: discountAmount > 0 ? user.id : null,
        totalAmount,
        paymentMethod: input.paymentMethod,
        cashAmount,
        upiAmount,
        status: "COMPLETED",
        breakdown: {
          gaming: bill.gaming,
          food: bill.food.lines,
          // Who was on the station, and what each of them came to. Stored as a
          // snapshot so the receipt can be reprinted years later unchanged.
          players: bill.players.map((player, index) => ({
            slot: player.slot,
            label: player.label,
            memberCode: player.memberCode,
            customerType: player.customerType,
            gaming: player.amount,
            share: playerShares[index],
          })),
          playerCount: bill.session.playerCount,
          pricingModel: bill.session.pricingModel,
          playstationType: bill.station.playstationType,
          pricedAt: now.toISOString(),
          pricedBy: user.name,
          override: overrideApplied
            ? { calculated: calculatedGaming, charged: gamingAmount, reason: input.overrideReason, by: user.name }
            : null,
        },
        staffId: user.id,
      })
      .returning();

    const paymentRows: (typeof payments.$inferInsert)[] = [];
    if (cashAmount > 0) {
      paymentRows.push({ transactionId: transaction.id, channel: "CASH", amount: cashAmount });
    }
    if (upiAmount > 0) {
      paymentRows.push({
        transactionId: transaction.id,
        channel: "UPI",
        amount: upiAmount,
        reference: input.upiReference,
      });
    }
    if (paymentRows.length > 0) await tx.insert(payments).values(paymentRows);

    for (const [index, player] of bill.players.entries()) {
      await tx
        .update(sessionPlayers)
        .set({ amount: playerShares[index] })
        .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.slot, player.slot)));
    }

    await tx
      .update(gameSessions)
      .set({ status: "COMPLETED", endedAt, endedById: user.id, updatedAt: now })
      .where(eq(gameSessions.id, session.id));

    await tx.update(stations).set({ status: "AVAILABLE", updatedAt: now }).where(eq(stations.id, session.stationId));

    if (session.reservationId) {
      await tx
        .update(reservations)
        .set({ status: "COMPLETED", updatedAt: now })
        .where(eq(reservations.id, session.reservationId));
    }

    await recordAudit(
      {
        action: "transaction.created",
        userId: user.id,
        userLabel: user.name,
        entityType: "transaction",
        entityId: transaction.id,
        metadata: {
          code,
          station: bill.station.code,
          total: totalAmount,
          gaming: gamingAmount,
          food: bill.food.amount,
          method: input.paymentMethod,
        },
      },
      tx,
    );

    if (overrideApplied) {
      await recordAudit(
        {
          action: "checkout.amount_overridden",
          userId: user.id,
          userLabel: user.name,
          entityType: "transaction",
          entityId: transaction.id,
          metadata: {
            code,
            calculated: calculatedGaming,
            charged: gamingAmount,
            reason: input.overrideReason,
          },
        },
        tx,
      );
    }

    if (discountAmount > 0) {
      await recordAudit(
        {
          action: "discount.applied",
          userId: user.id,
          userLabel: user.name,
          entityType: "transaction",
          entityId: transaction.id,
          metadata: {
            code,
            type: input.discountType,
            value: input.discountValue,
            amount: discountAmount,
            reason: input.discountReason,
          },
        },
        tx,
      );
    }

    return transaction;
  });
}

/** Full receipt payload for the receipt screen and the print view. */
export async function getTransactionDetail(transactionId: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1);
  if (!row) throw new NotFoundError("Transaction not found.");

  const paymentRows = await db.select().from(payments).where(eq(payments.transactionId, transactionId));

  const [staffRow] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.staffId))
    .limit(1);

  return { transaction: row, payments: paymentRows, staffName: staffRow?.name ?? "—" };
}

export async function findTransactionBySession(sessionId: string) {
  const [row] = await db.select().from(transactions).where(eq(transactions.sessionId, sessionId)).limit(1);
  return row ?? null;
}

/**
 * Permanently delete a transaction.
 *
 * Only a VOID transaction can be removed, and only by an admin. A completed
 * sale must be voided first — that way the money trail always shows the
 * correction being made deliberately, and a real sale can never disappear with
 * a single click. The session stays in history and its station is untouched.
 */
export async function deleteTransaction(transactionId: string, user: SessionUser) {
  if (user.role !== "ADMIN") {
    throw new ForbiddenError("Only an admin can permanently delete a bill.");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1).for("update");
    if (!row) throw new NotFoundError("Transaction not found.");
    if (row.status !== "VOID") {
      throw new ConflictError(
        "Void this bill first. Deleting a completed sale outright would silently change your income figures.",
      );
    }

    // Payments are removed by the cascade on payments.transaction_id.
    await tx.delete(transactions).where(eq(transactions.id, transactionId));

    await recordAudit(
      {
        action: "transaction.deleted",
        userId: user.id,
        userLabel: user.name,
        entityType: "transaction",
        entityId: transactionId,
        metadata: { code: row.code, total: row.totalAmount, station: row.stationSnapshot },
      },
      tx,
    );
  });
}

/** Void a transaction (manager correction). History is preserved. */
export async function voidTransaction(transactionId: string, reason: string, user: SessionUser) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).limit(1).for("update");
    if (!row) throw new NotFoundError("Transaction not found.");
    if (row.status !== "COMPLETED") throw new ConflictError("This transaction is already voided or refunded.");

    await tx
      .update(transactions)
      .set({ status: "VOID", updatedAt: new Date() })
      .where(inArray(transactions.id, [transactionId]));

    await recordAudit(
      {
        action: "transaction.voided",
        userId: user.id,
        userLabel: user.name,
        entityType: "transaction",
        entityId: transactionId,
        metadata: { code: row.code, reason, total: row.totalAmount },
      },
      tx,
    );
  });
}
