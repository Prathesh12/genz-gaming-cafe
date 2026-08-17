import { redirect } from "next/navigation";

import { AppShell } from "@/components/nav/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { NAV_ITEMS } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { getSettings, logoVersion } from "@/server/services/settings";

/** The console is always live data — never statically cached. */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const settings = await getSettings();
  const allowedHrefs = NAV_ITEMS.filter((item) => can(user, item.permission)).map((item) => item.href);

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      allowedHrefs={allowedHrefs}
      cafeName={settings.cafeName}
      logoVersion={logoVersion(settings)}
    >
      {children}
    </AppShell>
  );
}
