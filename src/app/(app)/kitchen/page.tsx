import type { Metadata } from "next";

import { AutoRefresh } from "@/components/nav/auto-refresh";
import { requirePermission } from "@/lib/auth";
import { listOpenFoodOrders } from "@/server/services/food";
import { getSettings } from "@/server/services/settings";

import { KitchenClient } from "./kitchen-client";

export const metadata: Metadata = { title: "Kitchen" };
export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  await requirePermission("food.view");
  const [orders, settings] = await Promise.all([listOpenFoodOrders(), getSettings()]);

  return (
    <div className="space-y-4">
      {/* Refreshes quickly: this screen is meant to be left open in the kitchen. */}
      <AutoRefresh intervalMs={10000} />
      <p className="text-sm text-ink-muted">
        Orders appear the moment staff add them to a station and disappear once served.
      </p>
      <KitchenClient
        currencySymbol={settings.currencySymbol}
        orders={orders.map((order) => ({
          id: order.id,
          code: order.code,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
          sessionCode: order.sessionCode,
          stationLabel: `${order.stationCode} — ${order.stationName}`,
          items: order.items,
          total: order.total,
        }))}
      />
    </div>
  );
}
