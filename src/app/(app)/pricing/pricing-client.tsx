"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { Copy, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { formatMoney, toMajor } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import { cn } from "@/lib/utils";
import { copyPricingAction, deletePricingRuleAction, savePricingRuleAction } from "@/server/actions/pricing";
import type { PricingRuleRow } from "@/server/services/pricing";

type Category = { id: string; name: string; color: string };

const PANELS = [
  { customerType: "REGULAR", timeBand: "NORMAL", title: "Regular · Normal hours", icon: Sun },
  { customerType: "REGULAR", timeBand: "NIGHT", title: "Regular · Night gaming", icon: Moon },
  { customerType: "MEMBER", timeBand: "NORMAL", title: "Member · Normal hours", icon: Sun },
  { customerType: "MEMBER", timeBand: "NIGHT", title: "Member · Night gaming", icon: Moon },
] as const;

export function PricingClient({
  categories,
  rules,
  canManage,
  currencySymbol,
  nightWindow,
  dayPassMinutes,
  dayPassEnabled,
}: {
  categories: Category[];
  rules: PricingRuleRow[];
  canManage: boolean;
  currencySymbol: string;
  nightWindow: string;
  dayPassMinutes: number;
  dayPassEnabled: boolean;
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [editing, setEditing] = useState<PricingRuleRow | "new" | null>(null);
  const [presetPanel, setPresetPanel] = useState<{ customerType: string; timeBand: string; kind: string } | null>(null);
  const [deleting, setDeleting] = useState<PricingRuleRow | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [pending, startTransition] = useTransition();

  const active = rules.filter((rule) => rule.isActive && rule.categoryId === categoryId);

  const dayPasses = active.filter((rule) => rule.kind === "DAY_PASS");

  if (categories.length === 0) {
    return (
      <EmptyState
        title="Create a station category first"
        description="Pricing is configured per station category, so add categories such as Gaming PC or PS5 before setting rates."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setCategoryId(category.id)}
            aria-pressed={categoryId === category.id}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              categoryId === category.id
                ? "border-gold bg-gold/15 text-gold"
                : "border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:text-ink",
            )}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: category.color }} aria-hidden />
            {category.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
        <span>
          Night gaming runs <span className="font-semibold text-ink">{nightWindow}</span>. A session that crosses the
          boundary is split and each part billed at its own rate.
        </span>
        {canManage && categories.length > 1 ? (
          <div className="ml-auto flex items-center gap-2">
            <NativeSelect
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
              className="h-9 w-44"
              aria-label="Copy pricing from category"
            >
              <option value="">Copy prices from…</option>
              {categories
                .filter((category) => category.id !== categoryId)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="secondary"
              disabled={!copyFrom || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await copyPricingAction(copyFrom, categoryId);
                  if (result.ok) {
                    toast.success(`Copied ${result.data} rule(s)`);
                    setCopyFrom("");
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                })
              }
            >
              <Copy aria-hidden />
              Copy
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PANELS.map((panel) => {
          const slabs = active
            .filter(
              (rule) =>
                rule.kind === "SLAB" && rule.customerType === panel.customerType && rule.timeBand === panel.timeBand,
            )
            .sort((a, b) => a.durationMinutes - b.durationMinutes);
          const Icon = panel.icon;

          return (
            <Card key={panel.title}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4 text-gold" aria-hidden />
                  {panel.title}
                </CardTitle>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPresetPanel({ customerType: panel.customerType, timeBand: panel.timeBand, kind: "SLAB" });
                      setEditing("new");
                    }}
                  >
                    <Plus aria-hidden />
                    Slab
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent className="p-0">
                {slabs.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-ink-muted">
                    No slabs configured. Sessions in this band will fall back to the regular / normal rates.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {slabs.map((rule) => (
                      <li key={rule.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <span className="w-24 font-medium text-ink">{formatDurationHuman(rule.durationMinutes)}</span>
                        <span className="tabular flex-1 text-lg font-bold text-gold">
                          {formatMoney(rule.price, currencySymbol)}
                        </span>
                        <span className="tabular hidden text-xs text-ink-faint sm:block">
                          ≈ {formatMoney(Math.round((rule.price * 60) / rule.durationMinutes), currencySymbol)}/hr
                        </span>
                        {canManage ? (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setEditing(rule)} aria-label="Edit rule">
                              <Pencil />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleting(rule)} aria-label="Remove rule">
                              <Trash2 className="text-danger" />
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ------------------------------ Day pass ------------------------------ */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Day pass</CardTitle>
          {canManage ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPresetPanel({ customerType: "REGULAR", timeBand: "NORMAL", kind: "DAY_PASS" });
                setEditing("new");
              }}
            >
              <Plus aria-hidden />
              Day pass
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-ink-muted">
            {dayPassEnabled ? (
              <>
                Valid for <span className="font-semibold text-ink">{formatDurationHuman(dayPassMinutes)}</span> of play.
                It is applied automatically whenever it works out cheaper than slab pricing.
              </>
            ) : (
              <>Day passes are switched off in Settings.</>
            )}
          </p>
          {dayPasses.length === 0 ? (
            <p className="text-sm text-ink-faint">No day pass configured for this category.</p>
          ) : (
            <ul className="divide-y divide-line">
              {dayPasses.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 py-2">
                  <Badge tone={rule.customerType === "MEMBER" ? "gold" : "neutral"}>
                    {rule.customerType === "MEMBER" ? "Member" : "Regular"}
                  </Badge>
                  <span className="tabular flex-1 text-lg font-bold text-gold">
                    {formatMoney(rule.price, currencySymbol)}
                  </span>
                  {canManage ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(rule)} aria-label="Edit day pass">
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(rule)} aria-label="Remove day pass">
                        <Trash2 className="text-danger" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RuleDialog
        value={editing}
        preset={presetPanel}
        categoryId={categoryId}
        currencySymbol={currencySymbol}
        dayPassMinutes={dayPassMinutes}
        onClose={() => {
          setEditing(null);
          setPresetPanel(null);
        }}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove this price?"
        description={
          deleting
            ? `${formatDurationHuman(deleting.durationMinutes)} at ${formatMoney(deleting.price, currencySymbol)} will no longer be offered. Past bills keep the price they were charged.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        loading={pending}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const result = await deletePricingRuleAction(deleting.id);
            if (result.ok) {
              toast.success("Price removed");
              router.refresh();
            } else {
              toast.error(result.error);
            }
            setDeleting(null);
          });
        }}
      />
    </div>
  );
}

function RuleDialog({
  value,
  preset,
  categoryId,
  currencySymbol,
  dayPassMinutes,
  onClose,
  onSaved,
}: {
  value: PricingRuleRow | "new" | null;
  preset: { customerType: string; timeBand: string; kind: string } | null;
  categoryId: string;
  currencySymbol: string;
  dayPassMinutes: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(savePricingRuleAction, null);
  const editing = value && value !== "new" ? value : null;
  const kind = editing?.kind ?? preset?.kind ?? "SLAB";

  const defaults = useMemo(
    () => ({
      customerType: editing?.customerType ?? preset?.customerType ?? "REGULAR",
      timeBand: editing?.timeBand ?? preset?.timeBand ?? "NORMAL",
      durationMinutes: editing?.durationMinutes ?? (kind === "DAY_PASS" ? dayPassMinutes : 60),
      price: editing ? toMajor(editing.price) : "",
    }),
    [editing, preset, kind, dayPassMinutes],
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success("Price saved");
      onSaved();
      onClose();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={Boolean(value)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title={editing ? "Edit price" : kind === "DAY_PASS" ? "New day pass" : "New price slab"} />
        <DialogForm action={formAction} key={editing?.id ?? `new-${kind}-${defaults.customerType}-${defaults.timeBand}`}>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <input type="hidden" name="categoryId" value={editing?.categoryId ?? categoryId} />
          <input type="hidden" name="kind" value={kind} />
          <DialogBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer type" htmlFor="customerType">
                <NativeSelect id="customerType" name="customerType" defaultValue={defaults.customerType}>
                  <option value="REGULAR">Regular</option>
                  <option value="MEMBER">Member</option>
                </NativeSelect>
              </Field>
              <Field label="Time band" htmlFor="timeBand">
                <NativeSelect
                  id="timeBand"
                  name="timeBand"
                  defaultValue={defaults.timeBand}
                  disabled={kind === "DAY_PASS"}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="NIGHT">Night</option>
                </NativeSelect>
              </Field>
            </div>

            <Field
              label={kind === "DAY_PASS" ? "Validity (minutes)" : "Duration (minutes)"}
              htmlFor="durationMinutes"
              required
              hint={
                kind === "DAY_PASS"
                  ? "Usually matches the day pass validity in Settings."
                  : "e.g. 30, 60, 120, 180 — any duration you like."
              }
              error={state?.ok === false ? state.fieldErrors?.durationMinutes : undefined}
            >
              <Input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min={1}
                defaultValue={defaults.durationMinutes}
                required
              />
            </Field>

            <Field
              label={`Price (${currencySymbol})`}
              htmlFor="price"
              required
              error={state?.ok === false ? state.fieldErrors?.price : undefined}
            >
              <Input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min={0}
                defaultValue={defaults.price}
                placeholder="100"
                required
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Save price
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
