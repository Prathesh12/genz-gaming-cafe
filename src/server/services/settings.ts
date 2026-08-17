import "server-only";

import { cache } from "react";

import { eq, sql } from "drizzle-orm";

import { db, type DbClient } from "@/db";
import { businessSettings, type BusinessSettings } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { parseLogoDataUrl } from "@/lib/logo";
import { parseHHmm } from "@/lib/time";
import type { PricingConfig } from "@/server/pricing/engine";

/**
 * The singleton settings row. Created on demand so a fresh database is usable
 * before anyone visits the Settings screen.
 */
export const getSettings = cache(async (): Promise<BusinessSettings> => {
  const [row] = await db.select().from(businessSettings).where(eq(businessSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(businessSettings).values({ id: 1 }).returning();
  return created;
});

export async function getSettingsFor(client: DbClient): Promise<BusinessSettings> {
  const [row] = await client.select().from(businessSettings).where(eq(businessSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await client.insert(businessSettings).values({ id: 1 }).returning();
  return created;
}

/**
 * Store the cafe logo.
 *
 * The image arrives as a `data:` URL that the browser has already re-drawn to
 * PNG at a sensible size; it is checked again here because a check made in a
 * browser is only a courtesy. It goes into the settings row rather than onto
 * disk: this app runs on Vercel, whose filesystem is read-only at runtime and
 * replaced on every deploy, so a written file would simply disappear.
 */
export async function setLogo(dataUrl: string, user: SessionUser) {
  const parsed = parseLogoDataUrl(dataUrl);
  if (!parsed.ok) throw new ValidationError(parsed.reason);

  const now = new Date();
  await db
    .update(businessSettings)
    .set({ logoMime: parsed.mime, logoData: parsed.data, logoUpdatedAt: now, updatedAt: now })
    .where(eq(businessSettings.id, 1));

  await recordAudit({
    action: "settings.logo_updated",
    userId: user.id,
    userLabel: user.name,
    entityType: "settings",
    entityId: "1",
    metadata: { mime: parsed.mime, bytes: parsed.bytes },
  });
}

/** Remove the logo and fall back to the built-in badge. */
export async function clearLogo(user: SessionUser) {
  const now = new Date();
  await db
    .update(businessSettings)
    .set({ logoMime: null, logoData: null, logoUpdatedAt: now, updatedAt: now })
    .where(eq(businessSettings.id, 1));

  await recordAudit({
    action: "settings.logo_removed",
    userId: user.id,
    userLabel: user.name,
    entityType: "settings",
    entityId: "1",
  });
}

/**
 * A short token that changes whenever the logo does, used to bust the browser
 * cache. Without it a new logo would keep showing the old one until the cache
 * expired, which looks exactly like the upload having failed.
 */
export function logoVersion(settings: BusinessSettings): string | null {
  if (!settings.logoData) return null;
  return String(settings.logoUpdatedAt?.getTime() ?? 0);
}

/** Convert stored settings into the shape the pricing engine expects. */
export function toPricingConfig(settings: BusinessSettings): PricingConfig {
  return {
    timezone: settings.timezone,
    nightStartMinute: parseHHmm(settings.nightStart),
    nightEndMinute: parseHHmm(settings.nightEnd),
    dayPassEnabled: settings.dayPassEnabled,
    dayPassMinutes: settings.dayPassMinutes,
    minimumBillMinutes: settings.minimumBillMinutes,
    billingMode: settings.billingMode,
  };
}

/**
 * Atomically increment and format the next invoice number.
 * Must run inside the checkout transaction so two simultaneous checkouts can
 * never receive the same receipt number.
 */
export async function nextInvoiceCode(client: DbClient, when: Date): Promise<string> {
  const [row] = await client
    .update(businessSettings)
    .set({ invoiceCounter: sql`${businessSettings.invoiceCounter} + 1` })
    .where(eq(businessSettings.id, 1))
    .returning({ counter: businessSettings.invoiceCounter, prefix: businessSettings.invoicePrefix });

  const year = when.getUTCFullYear();
  return `${row.prefix}-${year}-${String(row.counter).padStart(6, "0")}`;
}
