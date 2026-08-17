"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/errors";
import {
  addTimeSchema,
  formDataToObject,
  parseOrThrow,
  setSessionPlayersSchema,
  startSessionSchema,
  uuidSchema,
} from "@/lib/schemas";
import { searchMembers } from "@/server/services/members";
import {
  addSessionTime,
  cancelSession,
  getSessionBill,
  pauseSession,
  resumeBilling,
  resumeSession,
  setSessionPlayers,
  startSession,
  stopBilling,
} from "@/server/services/sessions";

function refresh() {
  revalidatePath("/stations");
  revalidatePath("/dashboard");
  revalidatePath("/transactions");
}

export async function startSessionAction(
  _prev: ActionResult<{ sessionId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ sessionId: string }>> {
  try {
    const user = await requirePermission("sessions.operate");
    const input = parseOrThrow(startSessionSchema, formDataToObject(formData));
    const session = await startSession(input, user);
    refresh();
    return actionOk({ sessionId: session.id });
  } catch (error) {
    return actionError(error);
  }
}

export async function pauseSessionAction(sessionId: string, reason?: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("sessions.operate");
    await pauseSession(parseOrThrow(uuidSchema, sessionId), user, reason?.trim() || null);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function resumeSessionAction(sessionId: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("sessions.operate");
    await resumeSession(parseOrThrow(uuidSchema, sessionId), user);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function addTimeAction(sessionId: string, minutes: number): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("sessions.operate");
    const input = parseOrThrow(addTimeSchema, { sessionId, minutes });
    await addSessionTime(input.sessionId, input.minutes, user);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/** Stop the clock and open checkout. Safe to call twice. */
export async function stopBillingAction(sessionId: string): Promise<ActionResult<undefined>> {
  try {
    await requirePermission("sessions.operate");
    await stopBilling(parseOrThrow(uuidSchema, sessionId));
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/** The customer decided to keep playing — put the session back on the clock. */
export async function resumeBillingAction(sessionId: string): Promise<ActionResult<undefined>> {
  try {
    await requirePermission("sessions.operate");
    await resumeBilling(parseOrThrow(uuidSchema, sessionId));
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function cancelSessionAction(sessionId: string, reason: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    await cancelSession(parseOrThrow(uuidSchema, sessionId), reason.trim() || null, user);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export type SessionBillDto = {
  sessionCode: string;
  stationLabel: string;
  categoryName: string;
  customerName: string | null;
  customerType: "REGULAR" | "MEMBER";
  memberName: string | null;
  memberCode: string | null;
  playerCount: number;
  /** Each player and their own share of the gaming charge. */
  players: {
    slot: number;
    label: string;
    memberCode: string | null;
    customerType: "REGULAR" | "MEMBER";
    amount: number;
  }[];
  startedAt: string;
  billingEndsAt: string;
  billingStopped: boolean;
  wallMinutes: number;
  billedMinutes: number;
  pausedMinutes: number;
  gamingAmount: number;
  dayPassApplied: boolean;
  dayPassPrice: number | null;
  segments: {
    timeBand: string;
    customerType: string;
    minutes: number;
    amount: number;
    players: number;
    /** Set when charging by the minute, so the line can show "at ₹100/hr". */
    hourlyRate: number | null;
  }[];
  notes: string[];
  foodLines: { name: string; quantity: number; unitPrice: number; lineTotal: number; orderId: string; status: string }[];
  foodAmount: number;
  taxAmount: number;
  subtotal: number;
  currencySymbol: string;
};

/** Server-authoritative bill for the checkout dialog. */
export async function getSessionBillAction(
  sessionId: string,
  forceDayPass = false,
): Promise<ActionResult<SessionBillDto>> {
  try {
    await requirePermission("sessions.operate");
    const bill = await getSessionBill(parseOrThrow(uuidSchema, sessionId), undefined, forceDayPass);
    return actionOk({
      sessionCode: bill.session.code,
      stationLabel: `${bill.station.code} — ${bill.station.name}`,
      categoryName: bill.station.categoryName,
      customerName: bill.session.customerName,
      customerType: bill.session.customerType,
      memberName: bill.session.memberName,
      memberCode: bill.session.memberCode,
      playerCount: bill.session.playerCount,
      players: bill.players.map((player) => ({
        slot: player.slot,
        label: player.label,
        memberCode: player.memberCode,
        customerType: player.customerType,
        amount: player.amount,
      })),
      startedAt: bill.session.startedAt.toISOString(),
      billingEndsAt: bill.session.billingEndsAt.toISOString(),
      billingStopped: Boolean(bill.session.endedAt),
      wallMinutes: bill.gaming.wallMinutes,
      billedMinutes: bill.gaming.billedMinutes,
      pausedMinutes: bill.gaming.pausedMinutes,
      gamingAmount: bill.gaming.amount,
      dayPassApplied: bill.gaming.dayPassApplied,
      dayPassPrice: bill.gaming.dayPassPrice,
      segments: bill.gaming.segments.map((segment) => ({
        timeBand: segment.timeBand,
        customerType: segment.customerType,
        minutes: segment.minutes,
        amount: segment.amount,
        players: segment.players ?? 1,
        hourlyRate: segment.hourlyRate ?? null,
      })),
      notes: bill.gaming.notes,
      foodLines: bill.food.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        orderId: line.orderId,
        status: line.status,
      })),
      foodAmount: bill.food.amount,
      taxAmount: bill.food.taxAmount,
      subtotal: bill.subtotal,
      currencySymbol: bill.currencySymbol,
    });
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Change who is playing on a live session — somebody joined late, or the wrong
 * member was picked at the counter. Everyone listed is billed for the whole
 * session; there is no per-player clock.
 */
export async function setSessionPlayersAction(
  sessionId: string,
  players: { memberId: string | null; name: string | null }[],
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("sessions.operate");
    const input = parseOrThrow(setSessionPlayersSchema, { sessionId, players });
    await setSessionPlayers(input.sessionId, input.players, user);
    refresh();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function searchMembersAction(query: string) {
  try {
    await requirePermission("members.view");
    return actionOk(await searchMembers(query));
  } catch (error) {
    return actionError(error);
  }
}
