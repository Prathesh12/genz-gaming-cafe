import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { listStaff } from "@/server/services/admin";

import { StaffClient } from "./staff-client";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const user = await requirePermission("staff.manage");
  const staff = await listStaff();

  return (
    <StaffClient
      currentUserId={user.id}
      staff={staff.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        isActive: member.isActive,
        canDiscount: member.canDiscount,
        maxDiscountPercent: member.maxDiscountPercent,
        canViewSensitive: member.canViewSensitive,
        lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
      }))}
    />
  );
}
