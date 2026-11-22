import type { Metadata } from "next";

import { Download } from "lucide-react";
import Link from "next/link";

import { PaymentBadge } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePermission } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import { listTransactions } from "@/server/services/income";
import { listStations } from "@/server/services/stations";

import { TransactionFilters } from "./filters";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requirePermission("transactions.view");
  const params = await searchParams;

  const [result, stations] = await Promise.all([
    listTransactions({
      search: params.search,
      paymentMethod: params.paymentMethod as "CASH" | "UPI" | "SPLIT" | undefined,
      stationId: params.stationId,
      status: params.status as "COMPLETED" | "VOID" | "REFUNDED" | undefined,
      from: params.from,
      to: params.to,
      page: params.page ? Number(params.page) : 1,
    }),
    listStations(true),
  ]);

  const symbol = result.currencySymbol;
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => Boolean(value)) as [string, string][],
  );

  function pageHref(page: number) {
    const next = new URLSearchParams(query.toString());
    next.set("page", String(page));
    return `/transactions?${next.toString()}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TransactionFilters stations={stations.map((s) => ({ id: s.id, code: s.code, name: s.name }))} />
        </div>
        <Button variant="secondary" asChild>
          <Link href={`/api/export?type=transactions&${query.toString()}`} prefetch={false}>
            <Download aria-hidden />
            Export CSV
          </Link>
        </Button>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState title="No transactions found" description="Adjust the filters, or take your first payment." />
      ) : (
        <>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Bill</TH>
                  <TH>Date / time</TH>
                  <TH>Customer</TH>
                  <TH>Room</TH>
                  <TH className="text-right">Played</TH>
                  <TH className="text-right">Gaming</TH>
                  <TH className="text-right">Food</TH>
                  <TH className="text-right">Total</TH>
                  <TH>Payment</TH>
                  <TH>Staff</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {result.rows.map((row) => (
                  <TR key={row.id} className={row.status === "VOID" ? "opacity-50" : ""}>
                    <TD className="font-mono text-xs font-semibold text-ink">{row.code}</TD>
                    <TD className="tabular text-ink-muted">
                      {new Date(row.createdAt).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TD>
                    <TD>
                      {row.customerName ?? "Walk-in"}
                      {row.customerType === "MEMBER" ? (
                        <Badge tone="gold" className="ml-2">
                          Member
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="text-ink-muted">{row.station}</TD>
                    <TD className="tabular text-right text-ink-muted">{formatDurationHuman(row.billedMinutes)}</TD>
                    <TD className="tabular text-right">{formatMoney(row.gamingAmount, symbol)}</TD>
                    <TD className="tabular text-right">{formatMoney(row.foodAmount, symbol)}</TD>
                    <TD className="tabular text-right font-bold text-gold">{formatMoney(row.totalAmount, symbol)}</TD>
                    <TD>
                      <PaymentBadge method={row.paymentMethod} />
                      {row.paymentMethod === "SPLIT" ? (
                        <span className="tabular ml-2 text-xs text-ink-faint">
                          {formatMoney(row.cashAmount, symbol)} / {formatMoney(row.upiAmount, symbol)}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-ink-muted">{row.staffName}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/transactions/${row.id}`}>View</Link>
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>

          <div className="flex items-center justify-between gap-3 text-sm text-ink-muted">
            <span>
              Page {result.page} of {result.pageCount} · {result.total} bill{result.total === 1 ? "" : "s"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild disabled={result.page <= 1}>
                <Link href={pageHref(Math.max(1, result.page - 1))}>Previous</Link>
              </Button>
              <Button variant="outline" size="sm" asChild disabled={result.page >= result.pageCount}>
                <Link href={pageHref(Math.min(result.pageCount, result.page + 1))}>Next</Link>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
