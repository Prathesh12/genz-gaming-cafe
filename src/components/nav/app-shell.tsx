"use client";

import { useState, useTransition } from "react";

import { LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-live";
import { NAV_ITEMS } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";
import { logoutAction } from "@/server/actions/auth";

export type ShellUser = { name: string; email: string; role: Role };

export function AppShell({
  user,
  allowedHrefs,
  cafeName,
  logoVersion,
  children,
}: {
  user: ShellUser;
  allowedHrefs: string[];
  cafeName: string;
  /** Changes when the logo does, so a replacement never shows stale. */
  logoVersion: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV_ITEMS.filter((item) => allowedHrefs.includes(item.href));
  const primary = items.filter((item) => item.primary).slice(0, 5);
  const current = items.find((item) => pathname.startsWith(item.href));

  return (
    <div className="min-h-dvh bg-canvas">
      {/* ---------------- Desktop sidebar ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <Brand cafeName={cafeName} logoVersion={logoVersion} />
        <nav className="scrollbar-slim flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Main">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>
        <UserPanel user={user} />
      </aside>

      {/* ---------------- Mobile drawer ---------------- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/70"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="animate-fade-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between">
              <Brand cafeName={cafeName} logoVersion={logoVersion} />
              <button
                onClick={() => setDrawerOpen(false)}
                className="mr-3 rounded-md p-2 text-ink-muted hover:bg-surface-3 hover:text-ink"
                aria-label="Close navigation"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="scrollbar-slim flex-1 space-y-1 overflow-y-auto px-3 py-3" aria-label="Main">
              {items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={pathname.startsWith(item.href)}
                  onNavigate={() => setDrawerOpen(false)}
                />
              ))}
            </nav>
            <UserPanel user={user} />
          </div>
        </div>
      ) : null}

      {/* ---------------- Content ---------------- */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:px-5">
          <button
            className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="truncate text-sm font-bold tracking-wider text-ink uppercase">
            {current?.label ?? "GENZ Gaming Cafe"}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <Clock />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-3 pt-4 pb-24 sm:px-5 lg:pb-8">{children}</main>
      </div>

      {/* ---------------- Mobile bottom bar ---------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))` }}
        aria-label="Quick navigation"
      >
        {primary.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors",
                active ? "text-gold" : "text-ink-faint",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {item.shortLabel}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Brand({ cafeName, logoVersion }: { cafeName: string; logoVersion: string | null }) {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
      <BrandMark size={32} version={logoVersion} />
      <span className="truncate text-sm font-black tracking-wide text-ink uppercase">{cafeName}</span>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: (typeof NAV_ITEMS)[number];
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-l-2 border-gold bg-gold/10 pl-[10px] font-semibold text-gold"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
      {item.label}
    </Link>
  );
}

function UserPanel({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      const result = await logoutAction();
      if (result.ok) {
        router.replace("/login");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex items-center gap-3 border-t border-line px-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-gold">
        {initials(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
        <p className="truncate text-xs text-ink-faint">{ROLE_LABELS[user.role]}</p>
      </div>
      <Button variant="ghost" size="icon" onClick={signOut} loading={pending} aria-label="Sign out" title="Sign out">
        <LogOut />
      </Button>
    </div>
  );
}

function Clock() {
  const now = useNow(1000);

  if (!now) return <span className="tabular text-sm text-ink-faint">--:--:--</span>;

  return (
    <time className="tabular text-sm font-medium text-ink-muted" dateTime={now.toISOString()}>
      {now.toLocaleTimeString("en-IN", { hour12: true })}
    </time>
  );
}
