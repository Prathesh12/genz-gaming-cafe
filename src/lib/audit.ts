import "server-only";

import { db, type DbClient } from "@/db";
import { auditLogs } from "@/db/schema";

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "station.created"
  | "station.updated"
  | "station.status_changed"
  | "station.deactivated"
  | "station.deleted"
  | "category.created"
  | "category.updated"
  | "category.deactivated"
  | "pricing.created"
  | "pricing.updated"
  | "pricing.deleted"
  | "session.started"
  | "session.paused"
  | "session.resumed"
  | "session.extended"
  | "session.cancelled"
  | "session.players_updated"
  | "session.ended"
  | "food.item_created"
  | "food.item_updated"
  | "food.item_deactivated"
  | "food.category_created"
  | "food.category_updated"
  | "food.order_created"
  | "food.order_status_changed"
  | "food.order_cancelled"
  | "transaction.created"
  | "transaction.voided"
  | "transaction.deleted"
  | "discount.applied"
  | "checkout.amount_overridden"
  | "member.created"
  | "member.updated"
  | "member.sensitive_viewed"
  | "membership.renewed"
  | "members.imported"
  | "reservation.created"
  | "reservation.cancelled"
  | "reservation.updated"
  | "staff.created"
  | "staff.updated"
  | "staff.deactivated"
  | "settings.updated"
  | "settings.logo_updated"
  | "settings.logo_removed";

type AuditInput = {
  action: AuditAction;
  userId?: string | null;
  userLabel?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
};

/**
 * Append-only activity trail. Never throws: a logging failure must not roll
 * back a completed sale. Pass `client` to record inside an open transaction.
 */
export async function recordAudit(input: AuditInput, client: DbClient = db): Promise<void> {
  try {
    await client.insert(auditLogs).values({
      action: input.action,
      userId: input.userId ?? null,
      userLabel: input.userLabel ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: sanitize(input.metadata ?? null),
      ipAddress: input.ipAddress ?? null,
    });
  } catch (error) {
    console.error("[genz] Failed to write audit log", input.action, error);
  }
}

const FORBIDDEN_KEYS = ["aadhaar", "aadhar", "password", "passwordhash", "token", "secret"];

/** Defence in depth: sensitive fields must never reach the audit trail. */
function sanitize(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden))) continue;
    clean[key] = value;
  }
  return clean;
}
