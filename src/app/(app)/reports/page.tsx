import type { Metadata } from "next";

import { Download } from "lucide-react";
import Link from "next/link";

import { CategoryRevenueChart, DailyRevenueChart, HourlyRevenueChart } from "@/components/charts/revenue-charts";
import { RangePicker } from "@/components/range-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import {
  getCategoryIncome,
  getDailyRevenue,
  getFoodSales,
  getHourlyRevenue,
  getIncomeTotals,
  getMembershipSales,
  getStationIncome,
  resolveRange,
  type RangePreset,
} from "@/server/services/income";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const range = await resolveRange((params.preset as RangePreset) ?? "month", params.from, params.to);
  const settings = await getSettings();
  const symbol = settings.currencySymbol;

  const [totals, daily, hourly, stationRows, categoryRows, foodRows, membershipSales] = await Promise.all([
    getIncomeTotals(range),
    getDailyRevenue(range),
    getHourlyRevenue(range),
    getStationIncome(range),
    getCategoryIncome(range),
    getFoodSales(range),
    getMembershipSales(range),
  ]);

  const busiest = [...hourly].sort((a, b) => b.total - a.total).slice(0, 3);
  const exportBase = new URLSearchParams({
    preset: range.preset,
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  }).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker preset={range.preset} from={params.from} to={params.to} />
        <div className="flex flex-wrap gap-2">
          {[
            { type: "transactions", label: "Transactions" },
            { type: "stations", label: "Stations" },
            { type: "food", label: "Food" },
            { type: "sessions", label: "Sessions" },
          ].map((item) => (
            <Button key={item.type} variant="secondary" size="sm" asChild>
              <Link href={`/api/export?type=${item.type}&${exportBase}`} prefetch={false}>
                <Download aria-hidden />
                {item.label}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <StatGrid>
        <StatCard label={`Revenue · ${range.label}`} value={formatMoney(totals.total, symbol)} accent />
        <StatCard label="Sessions" value={String(totals.transactionCount)} sub={`Avg ${formatDurationHuman(totals.averageMinutes)}`} />
        <StatCard label="Average bill" value={formatMoney(totals.averageTicket, symbol)} />
        <StatCard
          label="Memberships sold"
          value={String(membershipSales.count)}
          sub={formatMoney(membershipSales.revenue, symbol)}
        />
      </StatGrid>

      <Card>
        <CardHeader>
          <CardTitle>Daily revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyRevenueChart data={daily} currencySymbol={symbol} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Peak hours</CardTitle>
            <p className="text-sm text-ink-muted">
              {busiest[0] && busiest[0].total > 0
                ? busiest
                    .filter((hour) => hour.total > 0)
                    .map((hour) => `${hour.label} ${formatMoney(hour.total, symbol)}`)
                    .join(" · ")
                : "No sales in this range."}
            </p>
          </CardHeader>
          <CardContent>
            <HourlyRevenueChart data={hourly} currencySymbol={symbol} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue by station category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryRows.length === 0 ? (
              <p className="py-6 text-sm text-ink-muted">Nothing to show yet.</p>
            ) : (
              <CategoryRevenueChart data={categoryRows} currencySymbol={symbol} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Station performance</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stationRows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">No completed sessions in this range.</p>
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Station</TH>
                    <TH className="text-right">Sessions</TH>
                    <TH className="text-right">Hours played</TH>
                    <TH className="text-right">Gaming</TH>
                    <TH className="text-right">Food</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Avg / session</TH>
                  </TR>
                </THead>
                <TBody>
                  {stationRows.map((row) => (
                    <TR key={row.stationId}>
                      <TD className="font-medium text-ink">{row.station}</TD>
                      <TD className="tabular text-right">{row.sessions}</TD>
                      <TD className="tabular text-right text-ink-muted">{(row.minutes / 60).toFixed(1)}</TD>
                      <TD className="tabular text-right">{formatMoney(row.gaming, symbol)}</TD>
                      <TD className="tabular text-right">{formatMoney(row.food, symbol)}</TD>
                      <TD className="tabular text-right font-bold text-gold">{formatMoney(row.total, symbol)}</TD>
                      <TD className="tabular text-right text-ink-muted">
                        {formatMoney(Math.round(row.total / Math.max(1, row.sessions)), symbol)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Food sales</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {foodRows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">No food sold in this range.</p>
          ) : (
            <TableWrap className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Item</TH>
                    <TH className="text-right">Orders</TH>
                    <TH className="text-right">Quantity</TH>
                    <TH className="text-right">Revenue</TH>
                  </TR>
                </THead>
                <TBody>
                  {foodRows.map((row) => (
                    <TR key={row.name}>
                      <TD className="font-medium text-ink">{row.name}</TD>
                      <TD className="tabular text-right">{row.orders}</TD>
                      <TD className="tabular text-right">{row.quantity}</TD>
                      <TD className="tabular text-right font-bold text-gold">{formatMoney(row.revenue, symbol)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
