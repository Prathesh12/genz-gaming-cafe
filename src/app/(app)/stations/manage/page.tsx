import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { listCategories, listStations } from "@/server/services/stations";

import { ManageClient } from "./manage-client";

export const metadata: Metadata = { title: "Manage stations" };
export const dynamic = "force-dynamic";

export default async function ManageStationsPage() {
  await requirePermission("stations.manage");
  const [categories, stations] = await Promise.all([listCategories(true), listStations(true)]);

  return (
    <ManageClient
      categories={categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        color: category.color,
        maxPlayers: category.maxPlayers,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      }))}
      stations={stations.map((station) => ({
        id: station.id,
        code: station.code,
        name: station.name,
        categoryId: station.categoryId,
        categoryName: station.categoryName,
        color: station.color,
        colorStyle: station.colorStyle,
        colorAccent: station.colorAccent,
        description: station.description,
        status: station.status,
        sortOrder: station.sortOrder,
        isActive: station.isActive,
      }))}
    />
  );
}
