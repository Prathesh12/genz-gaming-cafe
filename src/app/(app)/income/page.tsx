import type { Metadata } from "next";

import { Banknote, Download, IndianRupee, Smartphone, SplitSquareHorizontal } from "lucide-react";
import Link from "next/link";

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
  getIncomeTotals,
  getMembershipSales,
  getPaymentBreakdown,
  getStationIncome,
  resolveRange,
  type RangePreset,
} from "@/server/services/income";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Income" };
export const dynamic = "force-dynamic";

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("income.view");
  const params = await searchParams;
  const range = await resolveRange((params.preset as RangePreset) ?? "today", params.from, params.to);
  const settings = await getSettings();
  const symbol = settings.currencySymbol;

  const [totals, stationRows, categoryRows, payments, membershipSales] = await Promise.all([
    getIncomeTotals(range),
    getStationIncome(range),
    getCategoryIncome(range),
    getPaymentBreakdown(range),
    getMembershipSales(range),
  ]);

  const exportQuery = new URLSearchParams({
    type: "income",
    preset: range.preset,
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  }).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker preset={range.preset} from={params.from} to={params.to} />
        <Button variant="secondary" asChild>
          <Link href={`/api/export?${exportQuery}`} prefetch={false}>
            <Download aria-hidden />
            Export CSV
          </Link>
        </Button>
      </div>

      <p className="text-sm text-ink-muted">
        Showing <span className="font-semibold text-ink">{range.label}</span> ·{" "}
        {totals.transactionCount} completed bill{totals.transactionCount === 1 ? "" : "s"}
      </p>

      <StatGrid>
        <StatCard label="Total revenue" value={formatMoney(totals.total, symbol)} accent icon={<IndianRupee className="size-4" />} />
        <StatCard label="Gaming" value={formatMoney(totals.gaming, symbol)} sub={`Avg ${formatDurationHuman(totals.averageMinutes)} per session`} />
        <StatCard label="Food" value={formatMoney(totals.food, symbol)} sub={totals.tax > 0 ? `Tax ${formatMoney(totals.tax, symbol)}` : undefined} />
        <StatCard label="Discounts given" value={formatMoney(totals.discount, symbol)} sub={`Average bill ${formatMoney(totals.averageTicket, symbol)}`} />
      </StatGrid>

      <StatGrid>
        <StatCard label="Cash" value={formatMoney(payments.cash, symbol)} sub={`${payments.cashOnlyCount} cash-only bills`} icon={<Banknote className="size-4" />} />
        <StatCard label="UPI" value={formatMoney(payments.upi, symbol)} sub={`${payments.upiOnlyCount} UPI-only bills`} icon={<Smartphone className="size-4" />} />
        <StatCard
          label="Split bills"
          value={String(payments.splitCount)}
          sub={`${formatMoney(payments.splitCash, symbol)} cash + ${formatMoney(payments.splitUpi, symbol)} UPI`}
          icon={<SplitSquareHorizontal className="size-4" />}
        />
        <StatCard
          label="Membership fees"
          value={formatMoney(membershipSales.revenue, symbol)}
          sub={`${membershipSales.count} membership${membershipSales.count === 1 ? "" : "s"} sold — not counted in gaming revenue`}
        />
      </StatGrid>

      <Card>
        <CardHeader>
          <CardTitle>Member vs regular</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-gold uppercase">Members</p>
            <p className="tabular mt-1 text-2xl font-bold text-ink">{formatMoney(totals.memberRevenue, symbol)}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Regular customers</p>
            <p className="tabular mt-1 text-2xl font-bold text-ink">{formatMoney(totals.regularRevenue, symbol)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Station-wise income</CardTitle>
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
                    <TH>Category</TH>
                    <TH className="text-right">Sessions</TH>
                    <TH className="text-right">Played</TH>
                    <TH className="text-right">Gaming</TH>
                    <TH className="text-right">Food</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {stationRows.map((row) => (
                    <TR key={row.stationId}>
                      <TD className="font-medium text-ink">{row.station}</TD>
                      <TD className="text-ink-muted">{row.category}</TD>
                      <TD className="tabular text-right">{row.sessions}</TD>
                      <TD className="tabular text-right text-ink-muted">{formatDurationHuman(row.minutes)}</TD>
                      <TD className="tabular text-right">{formatMoney(row.gaming, symbol)}</TD>
                      <TD className="tabular text-right">{formatMoney(row.food, symbol)}</TD>
                      <TD className="tabular text-right font-bold text-gold">{formatMoney(row.total, symbol)}</TD>
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
          <CardTitle>Revenue by category</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {categoryRows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">Nothing to show yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {categoryRows.map((row) => (
                <li key={row.category} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="flex-1 font-medium text-ink">{row.category}</span>
                  <span className="tabular text-sm text-ink-muted">{row.sessions} sessions</span>
                  <span className="tabular w-28 text-right font-bold text-gold">{formatMoney(row.total, symbol)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
