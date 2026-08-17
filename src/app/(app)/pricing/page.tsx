import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listPricingRules } from "@/server/services/pricing";
import { getSettings } from "@/server/services/settings";
import { listCategories } from "@/server/services/stations";

import { PricingClient } from "./pricing-client";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const user = await requirePermission("pricing.view");
  const [categories, rules, settings] = await Promise.all([listCategories(), listPricingRules(), getSettings()]);

  return (
    <PricingClient
      categories={categories.map((category) => ({ id: category.id, name: category.name, color: category.color }))}
      rules={rules}
      canManage={can(user, "pricing.manage")}
      currencySymbol={settings.currencySymbol}
      nightWindow={`${settings.nightStart} → ${settings.nightEnd}`}
      dayPassMinutes={settings.dayPassMinutes}
      dayPassEnabled={settings.dayPassEnabled}
    />
  );
}
