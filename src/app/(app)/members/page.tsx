import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listMembers } from "@/server/services/members";
import { getSettings } from "@/server/services/settings";

import { MembersClient } from "./members-client";

export const metadata: Metadata = { title: "Members" };
export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const user = await requirePermission("members.view");
  const [members, settings] = await Promise.all([listMembers(), getSettings()]);

  return (
    <MembersClient
      members={members}
      canManage={can(user, "members.manage")}
      canViewSensitive={can(user, "members.viewSensitive")}
      currencySymbol={settings.currencySymbol}
      defaultMembershipPrice={settings.membershipPrice}
      membershipDays={settings.membershipDays}
    />
  );
}
