import type { Metadata } from "next";

import { desc } from "drizzle-orm";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { getSettings, logoVersion } from "@/server/services/settings";

import { LogoCard } from "./logo-card";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const settings = await getSettings();

  const activity = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      userLabel: auditLogs.userLabel,
      entityType: auditLogs.entityType,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(60);

  return (
    <div className="space-y-5">
      <LogoCard hasLogo={Boolean(settings.logoData)} version={logoVersion(settings)} />

      <SettingsForm
        values={{
          cafeName: settings.cafeName,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
          gstNumber: settings.gstNumber,
          taxEnabled: settings.taxEnabled,
          currencySymbol: settings.currencySymbol,
          nightStart: settings.nightStart,
          nightEnd: settings.nightEnd,
          dayPassEnabled: settings.dayPassEnabled,
          dayPassMinutes: settings.dayPassMinutes,
          membershipDays: settings.membershipDays,
          membershipPrice: settings.membershipPrice,
          membershipExpiryWarningDays: settings.membershipExpiryWarningDays,
          billingMode: settings.billingMode,
          minimumBillMinutes: settings.minimumBillMinutes,
          receiptFooter: settings.receiptFooter,
          invoicePrefix: settings.invoicePrefix,
          timezone: settings.timezone,
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Activity log</CardTitle>
          <p className="text-sm text-ink-muted">
            The last 60 recorded actions. Sign-ins, pricing changes, discounts, sensitive-data views and every sale are
            written here permanently.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-line">
            {activity.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5">
                <span className="font-mono text-xs text-gold">{entry.action}</span>
                <span className="text-ink">{entry.userLabel ?? "system"}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">
                  {entry.metadata ? JSON.stringify(entry.metadata) : entry.entityType}
                </span>
                <span className="tabular text-xs text-ink-faint">
                  {new Date(entry.createdAt).toLocaleString("en-IN")}
                </span>
              </li>
            ))}
            {activity.length === 0 ? <li className="px-5 py-6 text-sm text-ink-muted">No activity yet.</li> : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
