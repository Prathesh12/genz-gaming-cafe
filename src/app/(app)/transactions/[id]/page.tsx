import type { Metadata } from "next";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { Badge, PaymentBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import { getTransactionDetail } from "@/server/services/checkout";
import { getSettings, logoVersion } from "@/server/services/settings";

import { PrintButton } from "./print-button";
import { DeleteTransactionButton, VoidButton } from "./void-button";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

type Breakdown = {
  gaming?: {
    segments?: {
      timeBand: string;
      customerType: string;
      minutes: number;
      amount: number;
      players?: number;
      hourlyRate?: number;
    }[];
    notes?: string[];
    dayPassApplied?: boolean;
    pausedMinutes?: number;
  };
  food?: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  players?: {
    slot: number;
    label: string;
    memberCode: string | null;
    customerType: string;
    gaming: number;
    share: number;
  }[];
  playerCount?: number;
  override?: { calculated: number; charged: number; reason: string | null; by: string } | null;
};

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("transactions.view");
  const { id } = await params;

  let detail;
  try {
    detail = await getTransactionDetail(id);
  } catch {
    notFound();
  }

  const settings = await getSettings();
  const symbol = settings.currencySymbol;
  const { transaction, payments, staffName } = detail;
  const breakdown = (transaction.breakdown ?? {}) as Breakdown;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" asChild>
          <Link href="/transactions">
            <ArrowLeft aria-hidden />
            All transactions
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {transaction.status !== "COMPLETED" ? <Badge tone="danger">{transaction.status}</Badge> : null}
          {can(user, "income.view") && transaction.status === "COMPLETED" ? (
            <VoidButton transactionId={transaction.id} code={transaction.code} />
          ) : null}
          {user.role === "ADMIN" && transaction.status === "VOID" ? (
            <DeleteTransactionButton transactionId={transaction.id} code={transaction.code} />
          ) : null}
          <PrintButton />
        </div>
      </div>

      {/* 80mm-friendly receipt. The print stylesheet in globals.css strips the
          app chrome and forces black-on-white for thermal printers. */}
      <div className="receipt-sheet mx-auto w-full max-w-[380px] rounded-xl border border-line bg-surface p-5 text-sm">
        <div className="text-center">
          <BrandMark size={64} rounded={false} version={logoVersion(settings)} className="mx-auto mb-2" />
          <p className="text-lg font-black tracking-wide text-ink uppercase">{settings.cafeName}</p>
          {settings.address ? <p className="text-xs text-ink-muted">{settings.address}</p> : null}
          {settings.phone ? <p className="text-xs text-ink-muted">Ph: {settings.phone}</p> : null}
          {settings.gstNumber ? <p className="text-xs text-ink-muted">GST: {settings.gstNumber}</p> : null}
        </div>

        <div className="my-3 border-t border-dashed border-line-strong" />

        <dl className="space-y-1 text-xs">
          <Row label="Bill" value={transaction.code} mono />
          <Row
            label="Date"
            value={new Date(transaction.createdAt).toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
          <Row label="Station" value={transaction.stationSnapshot} />
          <Row
            label={transaction.playerCount > 1 ? "Players" : "Customer"}
            value={
              transaction.playerCount > 1
                ? String(transaction.playerCount)
                : (transaction.customerName ?? "Walk-in")
            }
          />
          {transaction.playerCount === 1 && transaction.customerType === "MEMBER" ? (
            <Row label="Rate" value="Member pricing" />
          ) : null}
          <Row
            label="Session"
            value={`${formatDurationHuman(transaction.billedMinutes)}${
              transaction.durationMinutes !== transaction.billedMinutes
                ? ` (of ${formatDurationHuman(transaction.durationMinutes)})`
                : ""
            }`}
          />
          <Row label="Staff" value={staffName} />
        </dl>

        <div className="my-3 border-t border-dashed border-line-strong" />

        <table className="w-full text-xs">
          <tbody>
            {breakdown.override ? (
              <tr>
                <td className="py-0.5 text-ink-muted">Gaming (agreed amount)</td>
                <td className="tabular py-0.5 text-right text-ink">
                  {formatMoney(transaction.gamingAmount, symbol)}
                </td>
              </tr>
            ) : null}
            {(breakdown.override ? [] : (breakdown.gaming?.segments ?? [])).map((segment, index) => (
              <tr key={`seg-${index}`}>
                <td className="py-0.5 text-ink-muted">
                  Gaming · {segment.timeBand === "NIGHT" ? "Night" : "Normal"}
                  {transaction.playerCount > 1 || segment.customerType === "MEMBER"
                    ? ` · ${segment.customerType === "MEMBER" ? "Member" : "Regular"}`
                    : ""}
                  {(segment.players ?? 1) > 1 ? ` × ${segment.players}` : ""} (
                  {formatDurationHuman(segment.minutes)}
                  {segment.hourlyRate ? ` @ ${formatMoney(segment.hourlyRate, symbol)}/hr` : ""})
                </td>
                <td className="tabular py-0.5 text-right text-ink">{formatMoney(segment.amount, symbol)}</td>
              </tr>
            ))}
            {!breakdown.override && (breakdown.gaming?.segments?.length ?? 0) === 0 ? (
              <tr>
                <td className="py-0.5 text-ink-muted">Gaming</td>
                <td className="tabular py-0.5 text-right text-ink">{formatMoney(transaction.gamingAmount, symbol)}</td>
              </tr>
            ) : breakdown.override ? null : (
              <tr>
                <td className="py-0.5 font-semibold text-ink">Gaming total</td>
                <td className="tabular py-0.5 text-right font-semibold text-ink">
                  {formatMoney(transaction.gamingAmount, symbol)}
                </td>
              </tr>
            )}

            {(breakdown.food ?? []).map((line, index) => (
              <tr key={`food-${index}`}>
                <td className="py-0.5 text-ink-muted">
                  {line.name} × {line.quantity}
                </td>
                <td className="tabular py-0.5 text-right text-ink">{formatMoney(line.lineTotal, symbol)}</td>
              </tr>
            ))}
            {transaction.foodAmount > 0 ? (
              <tr>
                <td className="py-0.5 font-semibold text-ink">Food total</td>
                <td className="tabular py-0.5 text-right font-semibold text-ink">
                  {formatMoney(transaction.foodAmount, symbol)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {transaction.playerCount > 1 && breakdown.players?.length ? (
          <>
            <div className="my-2 border-t border-dashed border-line-strong" />
            <p className="mb-1 text-[10px] font-semibold tracking-wide text-ink-muted uppercase">
              Players
            </p>
            <table className="w-full text-xs">
              <tbody>
                {breakdown.players.map((player) => (
                  <tr key={player.slot}>
                    <td className="py-0.5 text-ink-muted">
                      {player.slot}. {player.label}
                      <span className="ml-1 text-ink-faint">
                        {player.customerType === "MEMBER" ? "(member)" : "(regular)"}
                      </span>
                    </td>
                    <td className="tabular py-0.5 text-right text-ink">
                      {formatMoney(player.share, symbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        <div className="my-2 border-t border-dashed border-line-strong" />

        <dl className="space-y-1 text-xs">
          <Row label="Subtotal" value={formatMoney(transaction.subtotal, symbol)} />
          {transaction.taxAmount > 0 ? <Row label="Tax" value={formatMoney(transaction.taxAmount, symbol)} /> : null}
          {transaction.discountAmount > 0 ? (
            <Row
              label={`Discount${transaction.discountType === "PERCENT" ? ` (${transaction.discountValue}%)` : ""}`}
              value={`−${formatMoney(transaction.discountAmount, symbol)}`}
            />
          ) : null}
        </dl>

        <div className="my-2 flex items-baseline justify-between border-t border-line-strong pt-2">
          <span className="text-base font-black text-ink">TOTAL</span>
          <span className="tabular text-xl font-black text-gold">{formatMoney(transaction.totalAmount, symbol)}</span>
        </div>

        <div className="my-2 border-t border-dashed border-line-strong" />

        <div className="space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-ink-muted">Payment</span>
            <PaymentBadge method={transaction.paymentMethod} />
          </div>
          {payments.map((payment) => (
            <Row
              key={payment.id}
              label={payment.channel === "CASH" ? "Cash" : `UPI${payment.reference ? ` · ${payment.reference}` : ""}`}
              value={formatMoney(payment.amount, symbol)}
            />
          ))}
        </div>

        {breakdown.gaming?.notes?.length ? (
          <ul className="mt-3 space-y-0.5 text-[10px] text-ink-faint">
            {breakdown.gaming.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        ) : null}

        <p className="mt-4 text-center text-xs text-ink-muted">{settings.receiptFooter}</p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-right text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
