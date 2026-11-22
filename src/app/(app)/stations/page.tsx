import type { Metadata } from "next";

import { StationsWorkspace } from "@/components/stations/stations-workspace";
import { requirePermission } from "@/lib/auth";
import { can, discountCeiling } from "@/lib/permissions";
import { getOrderableMenu } from "@/server/services/food";
import { getStationBoard } from "@/server/services/stations";

export const metadata: Metadata = { title: "Rooms" };
export const dynamic = "force-dynamic";

export default async function StationsPage() {
  const user = await requirePermission("stations.view");
  const [board, menu] = await Promise.all([getStationBoard(), getOrderableMenu()]);

  return (
    <StationsWorkspace
      board={board}
      menu={menu}
      canManage={can(user, "stations.manage")}
      canDiscount={can(user, "discount.apply")}
      discountLimit={discountCeiling(user)}
    />
  );
}
