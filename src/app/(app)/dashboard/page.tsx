import type { Metadata } from "next";

import {
  Activity,
  Banknote,
  IndianRupee,
  MonitorPlay,
  Smartphone,
  SplitSquareHorizontal,
  TriangleAlert,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";

import { HourlyRevenueChart } from "@/components/charts/revenue-charts";
import { AutoRefresh } from "@/components/nav/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { requirePermission } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import { getDashboardData } from "@/server/services/income";
import { listExpiringMembers } from "@/server/services/members";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requirePermission("dashboard.view");
  const [data, expiring] = await Promise.all([getDashboardData(), listExpiringMembers()]);
  const symbol = data.currencySymbol;

  const peak = [...data.hourly].sort((a, b) => b.total - a.total)[0];

  return (
    <div className="space-y-5">
      {/* Polls the server so the counter view stays live without a refresh. */}
      <AutoRefresh intervalMs={20000} />

      {/* ------------------------------ Revenue ------------------------------ */}
      <StatGrid>
        <StatCard
          label="Revenue today"
          value={formatMoney(data.totals.total, symbol)}
          sub={`${data.totals.transactionCount} completed session${data.totals.transactionCount === 1 ? "" : "s"}`}
          icon={<IndianRupee className="size-4" />}
          accent
        />
        <StatCard
          label="Gaming"
          value={formatMoney(data.totals.gaming, symbol)}
          sub={`Avg session ${formatDurationHuman(data.totals.averageMinutes)}`}
          icon={<MonitorPlay className="size-4" />}
        />
        <StatCard
          label="Food"
          value={formatMoney(data.totals.food, symbol)}
          sub={data.totals.tax > 0 ? `Incl. tax ${formatMoney(data.totals.tax, symbol)}` : "Kitchen sales"}
          icon={<UtensilsCrossed className="size-4" />}
        />
        <StatCard
          label="Active sessions"
          value={`${data.activeSessions} / ${data.stations.total}`}
          sub={`${data.stations.available} station${data.stations.available === 1 ? "" : "s"} free right now`}
          icon={<Activity className="size-4" />}
        />
      </StatGrid>

      {/* ------------------------------ Payments ----------------------------- */}
      <StatGrid>
        <StatCard label="Cash collected" value={formatMoney(data.totals.cash, symbol)} icon={<Banknote className="size-4" />} />
        <StatCard label="UPI collected" value={formatMoney(data.totals.upi, symbol)} icon={<Smartphone className="size-4" />} />
        <StatCard
          label="Split payments"
          value={String(data.totals.splitCount)}
          sub="Counted once — each half lands in cash or UPI"
          icon={<SplitSquareHorizontal className="size-4" />}
        />
        <StatCard
          label="Average bill"
          value={formatMoney(data.totals.averageTicket, symbol)}
          sub={data.totals.discount > 0 ? `Discounts ${formatMoney(data.totals.discount, symbol)}` : "No discounts today"}
        />
      </StatGrid>

      {/* --------------------------- Station overview ------------------------ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Station overview</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/stations">Open the board</Link>
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusTile label="Available" value={data.stations.available} tone="ok" glyph="●" />
          <StatusTile label="Occupied" value={data.stations.occupied} tone="gold" glyph="▶" />
          <StatusTile label="Reserved" value={data.stations.reserved} tone="info" glyph="◆" />
          <StatusTile label="Maintenance" value={data.stations.maintenance} tone="warn" glyph="▲" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------ Chart ------------------------------ */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue by hour — today</CardTitle>
            {peak && peak.total > 0 ? (
              <p className="text-sm text-ink-muted">
                Busiest hour {peak.label} · <span className="font-semibold text-gold">{formatMoney(peak.total, symbol)}</span>
              </p>
            ) : (
              <p className="text-sm text-ink-muted">No sales recorded yet today.</p>
            )}
          </CardHeader>
          <CardContent>
            <HourlyRevenueChart data={data.hourly} currencySymbol={symbol} />
          </CardContent>
        </Card>

        {/* ----------------------------- Members ----------------------------- */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Members</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/members">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-ink-muted">
                <UsersRound className="size-4" aria-hidden />
                Active members
              </span>
              <span className="tabular text-xl font-bold text-ink">{data.members.active}</span>
            </div>

            {data.members.expiring > 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {data.members.expiring} membership{data.members.expiring === 1 ? " expires" : "s expire"} within{" "}
                  {data.warningDays} days.
                </span>
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No memberships expiring soon.</p>
            )}

            <ul className="divide-y divide-line">
              {expiring.slice(0, 5).map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{member.fullName}</span>
                    <span className="block truncate text-xs text-ink-faint">{member.memberCode}</span>
                  </span>
                  <Badge tone="warn">
                    {new Date(member.endDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* --------------------------- Top stations ---------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Top stations today</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.topStations.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">No completed sessions yet today.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.topStations.map((station) => (
                <li key={station.stationId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{station.station}</span>
                    <span className="block truncate text-xs text-ink-faint">
                      {station.category} · {station.sessions} session{station.sessions === 1 ? "" : "s"} ·{" "}
                      {formatDurationHuman(station.minutes)}
                    </span>
                  </span>
                  <span className="tabular text-right">
                    <span className="block font-bold text-gold">{formatMoney(station.total, symbol)}</span>
                    <span className="block text-xs text-ink-faint">
                      Food {formatMoney(station.food, symbol)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone,
  glyph,
}: {
  label: string;
  value: number;
  tone: "ok" | "gold" | "info" | "warn";
  glyph: string;
}) {
  const toneClass = {
    ok: "border-ok/40 bg-ok/10 text-ok",
    gold: "border-gold/40 bg-gold/10 text-gold",
    info: "border-info/40 bg-info/10 text-info",
    warn: "border-warn/40 bg-warn/10 text-warn",
  }[tone];

  return (
    <div className={`rounded-lg border px-3 py-3 ${toneClass}`}>
      <p className="text-xs font-semibold tracking-wide uppercase">
        <span aria-hidden>{glyph}</span> {label}
      </p>
      <p className="tabular mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
