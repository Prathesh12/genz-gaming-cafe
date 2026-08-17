import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listFoodCategories, listFoodItems } from "@/server/services/food";
import { getSettings } from "@/server/services/settings";

import { FoodClient } from "./food-client";

export const metadata: Metadata = { title: "Food menu" };
export const dynamic = "force-dynamic";

export default async function FoodPage() {
  const user = await requirePermission("food.view");
  const [categories, items, settings] = await Promise.all([
    listFoodCategories(true),
    listFoodItems(true),
    getSettings(),
  ]);

  return (
    <FoodClient
      categories={categories.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      }))}
      items={items}
      canManage={can(user, "food.manage")}
      currencySymbol={settings.currencySymbol}
      taxEnabled={settings.taxEnabled}
    />
  );
}
