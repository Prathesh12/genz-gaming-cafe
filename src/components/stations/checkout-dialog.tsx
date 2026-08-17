"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { Banknote, Receipt, Smartphone, SplitSquareHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";
import { formatMoney, toMajor } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import { cn } from "@/lib/utils";
import { checkoutAction } from "@/server/actions/checkout";
import { getSessionBillAction, resumeBillingAction, stopBillingAction, type SessionBillDto } from "@/server/actions/sessions";
import type { BoardStation } from "@/server/services/stations";

type Method = "CASH" | "UPI" | "SPLIT";

export function CheckoutDialog({
  station,
  currencySymbol,
  canDiscount,
  discountLimit,
  open,
  onOpenChange,
  onDone,
}: {
  station: BoardStation | null;
  currencySymbol: string;
  canDiscount: boolean;
  discountLimit: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [bill, setBill] = useState<SessionBillDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<Method>("CASH");
  const [discountType, setDiscountType] = useState<"NONE" | "FLAT" | "PERCENT">("NONE");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [cash, setCash] = useState("");
  const [editingAmount, setEditingAmount] = useState(false);
  const [overrideAmount, setOverrideAmount] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [, startTransition] = useTransition();
  const sessionId = station?.session?.id ?? null;

  /**
   * Freeze the clock, then fetch the authoritative bill. Nothing is charged
   * yet — stopping billing only pins the end time so the totals a staff member
   * reads cannot drift while they count cash.
   */
  async function refreshBill(id: string) {
    const stopped = await stopBillingAction(id);
    if (!stopped.ok) {
      toast.error(stopped.error);
      return null;
    }
    const result = await getSessionBillAction(id);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    return result.data;
  }

  /**
   * Success and failure are handled inside the action rather than in an
   * effect: navigating to the receipt and reloading a bill that moved are both
   * consequences of the submit, not of a render.
   */
  const [state, formAction, pending] = useActionState(
    async (previous: Awaited<ReturnType<typeof checkoutAction>> | null, formData: FormData) => {
      const result = await checkoutAction(previous, formData);
      if (result.ok) {
        toast.success("Payment recorded");
        onOpenChange(false);
        onDone();
        router.push(`/transactions/${result.data.transactionId}`);
      } else {
        toast.error(result.error);
        // The bill moved (food added, or another device changed something).
        if (result.code === "CONFLICT" && sessionId) {
          const fresh = await refreshBill(sessionId);
          if (fresh) setBill(fresh);
        }
      }
      return result;
    },
    null,
  );

  /**
   * Loads the bill once per opening. Every setState happens after an await, so
   * the board behind the dialog (which re-renders every second) cannot trigger
   * a second request.
   */
  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;

    void (async () => {
      const fresh = await refreshBill(sessionId);
      if (cancelled) return;
      if (fresh) setBill(fresh);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `refreshBill` is a plain function over `sessionId`; re-running on every
    // parent render would re-request the bill continuously.
     
  }, [open, sessionId]);

  /** Closing without paying puts the session back on the clock. */
  function handleOpenChange(next: boolean) {
    if (!next && sessionId && !state?.ok) {
      startTransition(async () => {
        await resumeBillingAction(sessionId);
        onDone();
      });
    }
    onOpenChange(next);
  }

  // A manually entered gaming charge replaces the calculated one. The server
  // re-applies the same override, so the two totals cannot disagree.
  const calculatedGaming = bill?.gamingAmount ?? 0;
  const overrideActive = editingAmount && overrideAmount.trim() !== "";
  const gamingAmount = overrideActive ? Math.round((Number(overrideAmount) || 0) * 100) : calculatedGaming;
  const subtotal = bill ? gamingAmount + bill.foodAmount + bill.taxAmount : 0;
  const numericDiscount = Number(discountValue) || 0;
  const discountAmount =
    discountType === "NONE" || numericDiscount <= 0
      ? 0
      : discountType === "PERCENT"
        ? Math.min(subtotal, Math.round((subtotal * Math.min(100, numericDiscount)) / 100))
        : Math.min(subtotal, Math.round(numericDiscount * 100));
  const total = Math.max(0, subtotal - discountAmount);
  const cashPaise = Math.round((Number(cash) || 0) * 100);
  const upiPaise = Math.max(0, total - cashPaise);
  const splitValid = method !== "SPLIT" || (cashPaise > 0 && cashPaise < total);
  const discountPercentEffective = subtotal > 0 ? (discountAmount * 100) / subtotal : 0;
  const discountTooLarge = discountAmount > 0 && discountPercentEffective > discountLimit + 0.001;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={`Checkout · ${station?.code ?? ""}`}
          description={bill ? `${bill.sessionCode} · ${bill.stationLabel}` : "Preparing the bill…"}
        />

        {loading || !bill ? (
          <DialogBody>
            <LoadingState label="Calculating the bill…" />
          </DialogBody>
        ) : (
          <DialogForm action={formAction}>
            <input type="hidden" name="sessionId" value={station?.session?.id ?? ""} />
            <input type="hidden" name="paymentMethod" value={method} />
            <input type="hidden" name="discountType" value={discountType} />
            <input type="hidden" name="discountValue" value={discountType === "NONE" ? 0 : numericDiscount} />
            <input type="hidden" name="discountReason" value={discountReason} />
            <input type="hidden" name="expectedTotal" value={total} />
            <input type="hidden" name="overrideGamingAmount" value={overrideActive ? overrideAmount : ""} />
            <input type="hidden" name="overrideReason" value={overrideActive ? overrideReason : ""} />
            <input
              type="hidden"
              name="cashAmount"
              value={method === "CASH" ? toMajor(total) : method === "SPLIT" ? toMajor(cashPaise) : 0}
            />
            <input
              type="hidden"
              name="upiAmount"
              value={method === "UPI" ? toMajor(total) : method === "SPLIT" ? toMajor(upiPaise) : 0}
            />

            <DialogBody className="space-y-4">
              {/* -------------------------- Summary -------------------------- */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm sm:grid-cols-4">
                <Summary
                  label={bill.playerCount > 1 ? "Players" : "Customer"}
                  value={bill.playerCount > 1 ? `${bill.playerCount} on this station` : (bill.customerName ?? "Walk-in")}
                />
                <Summary label="Station" value={bill.stationLabel.split(" — ")[0]} />
                <Summary label="Played" value={formatDurationHuman(bill.billedMinutes)} />
                <Summary
                  label="Rate type"
                  value={
                    bill.playerCount > 1
                      ? `${bill.players.filter((player) => player.customerType === "MEMBER").length} member${
                          bill.players.filter((player) => player.customerType === "MEMBER").length === 1 ? "" : "s"
                        }`
                      : bill.customerType === "MEMBER"
                        ? "Member"
                        : "Regular"
                  }
                  accent={
                    bill.playerCount > 1
                      ? bill.players.some((player) => player.customerType === "MEMBER")
                      : bill.customerType === "MEMBER"
                  }
                />
              </div>

              {/* --------------------- Who is playing ------------------------ */}
              {bill.playerCount > 1 ? (
                <div className="rounded-lg border border-line">
                  <p className="border-b border-line px-3 py-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    Each player at their own rate
                  </p>
                  <ul className="divide-y divide-line">
                    {bill.players.map((player) => (
                      <li key={player.slot} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] font-semibold text-ink-muted">
                            {player.slot}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{player.label}</span>
                            <span
                              className={
                                player.customerType === "MEMBER"
                                  ? "block text-xs font-semibold text-ok"
                                  : "block text-xs text-ink-faint"
                              }
                            >
                              {player.customerType === "MEMBER"
                                ? `Member rate${player.memberCode ? ` · ${player.memberCode}` : ""}`
                                : "Regular rate"}
                            </span>
                          </span>
                        </span>
                        <span className="tabular shrink-0 font-semibold text-ink">
                          {formatMoney(player.amount, currencySymbol)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* ------------------------- Breakdown ------------------------- */}
              <div className="rounded-lg border border-line">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {bill.segments.map((segment, index) => (
                      <tr key={`${segment.timeBand}-${segment.customerType}-${index}`}>
                        <td className="px-3 py-2 text-ink-muted">
                          Gaming · {segment.timeBand === "NIGHT" ? "Night" : "Normal"} ·{" "}
                          {segment.customerType === "MEMBER" ? "Member" : "Regular"}
                          {segment.players > 1 ? ` × ${segment.players}` : ""}
                          <span className="ml-1 text-xs text-ink-faint">
                            ({formatDurationHuman(segment.minutes)}
                            {segment.hourlyRate
                              ? ` at ${formatMoney(segment.hourlyRate, currencySymbol)}/hr`
                              : ""}
                            )
                          </span>
                        </td>
                        <td className="tabular px-3 py-2 text-right font-medium text-ink">
                          {formatMoney(segment.amount, currencySymbol)}
                        </td>
                      </tr>
                    ))}
                    {bill.dayPassApplied ? (
                      <tr>
                        <td className="px-3 py-2 text-ink-muted">Day pass</td>
                        <td className="tabular px-3 py-2 text-right font-medium text-ink">
                          {formatMoney(bill.gamingAmount, currencySymbol)}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="bg-surface-2/60">
                      <td className="px-3 py-2 font-semibold text-ink">
                        Gaming total
                        {canDiscount ? (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAmount((open) => !open);
                              if (!editingAmount && overrideAmount === "") {
                                setOverrideAmount(String(toMajor(calculatedGaming)));
                              }
                            }}
                            className="ml-2 align-middle text-xs font-medium text-gold underline underline-offset-2"
                          >
                            {editingAmount ? "cancel" : "change"}
                          </button>
                        ) : null}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-semibold text-ink">
                        {overrideActive ? (
                          <>
                            <span className="mr-2 text-xs font-normal text-ink-faint line-through">
                              {formatMoney(calculatedGaming, currencySymbol)}
                            </span>
                            <span className="text-gold">{formatMoney(gamingAmount, currencySymbol)}</span>
                          </>
                        ) : (
                          formatMoney(calculatedGaming, currencySymbol)
                        )}
                      </td>
                    </tr>
                    {bill.foodLines.map((line, index) => (
                      <tr key={`${line.orderId}-${line.name}-${index}`}>
                        <td className="px-3 py-2 text-ink-muted">
                          {line.name} × {line.quantity}
                        </td>
                        <td className="tabular px-3 py-2 text-right font-medium text-ink">
                          {formatMoney(line.lineTotal, currencySymbol)}
                        </td>
                      </tr>
                    ))}
                    {bill.foodAmount > 0 ? (
                      <tr className="bg-surface-2/60">
                        <td className="px-3 py-2 font-semibold text-ink">Food total</td>
                        <td className="tabular px-3 py-2 text-right font-semibold text-ink">
                          {formatMoney(bill.foodAmount, currencySymbol)}
                        </td>
                      </tr>
                    ) : null}
                    {bill.taxAmount > 0 ? (
                      <tr>
                        <td className="px-3 py-2 text-ink-muted">Tax</td>
                        <td className="tabular px-3 py-2 text-right font-medium text-ink">
                          {formatMoney(bill.taxAmount, currencySymbol)}
                        </td>
                      </tr>
                    ) : null}
                    <tr>
                      <td className="px-3 py-2 text-ink-muted">Subtotal</td>
                      <td className="tabular px-3 py-2 text-right font-medium text-ink">
                        {formatMoney(subtotal, currencySymbol)}
                      </td>
                    </tr>
                    {discountAmount > 0 ? (
                      <tr>
                        <td className="px-3 py-2 text-ok">Discount</td>
                        <td className="tabular px-3 py-2 text-right font-medium text-ok">
                          −{formatMoney(discountAmount, currencySymbol)}
                        </td>
                      </tr>
                    ) : null}
                    <tr className="bg-gold/10">
                      <td className="px-3 py-2.5 text-base font-bold text-ink">TOTAL</td>
                      <td className="tabular px-3 py-2.5 text-right text-xl font-black text-gold">
                        {formatMoney(total, currencySymbol)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {editingAmount ? (
                <div className="grid gap-3 rounded-lg border border-gold/40 bg-gold/5 p-3 sm:grid-cols-2">
                  <Field
                    label={`Gaming charge (${currencySymbol})`}
                    htmlFor="overrideAmount"
                    hint={`Calculated: ${formatMoney(calculatedGaming, currencySymbol)}. Leave blank to keep it.`}
                  >
                    <Input
                      id="overrideAmount"
                      value={overrideAmount}
                      onChange={(event) => setOverrideAmount(event.target.value.replace(/[^\d.]/g, ""))}
                      inputMode="decimal"
                      autoFocus
                    />
                  </Field>
                  <Field label="Reason" htmlFor="overrideReason" hint="Recorded in the activity log.">
                    <Input
                      id="overrideReason"
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="e.g. agreed price for a short session"
                    />
                  </Field>
                </div>
              ) : null}

              {bill.notes.length > 0 ? (
                <ul className="space-y-1 text-xs text-ink-faint">
                  {bill.notes.map((note) => (
                    <li key={note}>• {note}</li>
                  ))}
                </ul>
              ) : null}

              {/* -------------------------- Discount ------------------------- */}
              {canDiscount ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Discount" htmlFor="discountType">
                    <NativeSelect
                      id="discountType"
                      value={discountType}
                      onChange={(event) => setDiscountType(event.target.value as typeof discountType)}
                    >
                      <option value="NONE">None</option>
                      <option value="PERCENT">Percentage</option>
                      <option value="FLAT">Flat amount</option>
                    </NativeSelect>
                  </Field>
                  {discountType !== "NONE" ? (
                    <>
                      <Field
                        label={discountType === "PERCENT" ? "Percent" : `Amount (${currencySymbol})`}
                        htmlFor="discountValue"
                        error={discountTooLarge ? `Your limit is ${discountLimit}%.` : undefined}
                      >
                        <Input
                          id="discountValue"
                          value={discountValue}
                          onChange={(event) => setDiscountValue(event.target.value.replace(/[^\d.]/g, ""))}
                          inputMode="decimal"
                          placeholder="0"
                        />
                      </Field>
                      <Field label="Reason" htmlFor="discountReason">
                        <Input
                          id="discountReason"
                          value={discountReason}
                          onChange={(event) => setDiscountReason(event.target.value)}
                          placeholder="e.g. regular customer"
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
              ) : null}

              {/* -------------------------- Payment -------------------------- */}
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Payment method</p>
                <div className="grid grid-cols-3 gap-2">
                  <MethodButton
                    active={method === "CASH"}
                    onClick={() => setMethod("CASH")}
                    icon={<Banknote />}
                    label="Cash"
                  />
                  <MethodButton
                    active={method === "UPI"}
                    onClick={() => setMethod("UPI")}
                    icon={<Smartphone />}
                    label="UPI"
                  />
                  <MethodButton
                    active={method === "SPLIT"}
                    onClick={() => {
                      setMethod("SPLIT");
                      if (!cash) setCash(String(toMajor(Math.round(total / 2))));
                    }}
                    icon={<SplitSquareHorizontal />}
                    label="Split"
                  />
                </div>
              </div>

              {method === "SPLIT" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={`Cash (${currencySymbol})`}
                    htmlFor="cashInput"
                    error={!splitValid ? "Cash must be more than zero and less than the total." : undefined}
                  >
                    <Input
                      id="cashInput"
                      value={cash}
                      onChange={(event) => setCash(event.target.value.replace(/[^\d.]/g, ""))}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label={`UPI (${currencySymbol}) — calculated`} htmlFor="upiInput">
                    <Input id="upiInput" value={toMajor(upiPaise).toFixed(2)} readOnly className="opacity-80" />
                  </Field>
                  <p className="sm:col-span-2 text-xs text-ink-faint">
                    Cash + UPI must equal {formatMoney(total, currencySymbol)}. Currently{" "}
                    <span className={cn("font-semibold", splitValid ? "text-ok" : "text-danger")}>
                      {formatMoney(cashPaise + upiPaise, currencySymbol)}
                    </span>
                    .
                  </p>
                </div>
              ) : null}

              {method === "UPI" || method === "SPLIT" ? (
                <Field label="UPI reference (optional)" htmlFor="upiReference">
                  <Input id="upiReference" name="upiReference" placeholder="Txn ID / last 4 digits" />
                </Field>
              ) : null}

              {state?.ok === false ? (
                <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  {state.error}
                </p>
              ) : null}
            </DialogBody>

            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                Back — keep playing
              </Button>
              <Button type="submit" size="lg" loading={pending} disabled={!splitValid || discountTooLarge}>
                <Receipt aria-hidden />
                Take {formatMoney(total, currencySymbol)}
              </Button>
            </DialogFooter>
          </DialogForm>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={cn("truncate font-semibold", accent ? "text-gold" : "text-ink")}>{value}</p>
    </div>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border text-sm font-semibold transition-colors",
        active
          ? "border-gold bg-gold/15 text-gold"
          : "border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <span className="[&_svg]:size-5">{icon}</span>
      {label}
    </button>
  );
}
