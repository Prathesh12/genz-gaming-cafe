"use client";

import { useMemo, useState, useTransition } from "react";

import { BadgeCheck, Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FoodStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { addFoodOrderAction, cancelFoodOrderAction, setFoodOrderStatusAction } from "@/server/actions/food";
import type { BoardStation } from "@/server/services/stations";

/** Kitchen progression. An order at SERVED has no next step. */
const NEXT_STATUS = {
  ORDERED: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
} as const;

export type MenuEntry = {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  /** Null when members pay the ordinary price for this item. */
  memberPrice: number | null;
  taxPercent: number;
  prepMinutes: number | null;
};

/**
 * Member food prices follow the station: if anyone sitting there holds a valid
 * membership, the whole order is at member prices. The cafe's own rule, chosen
 * so a mixed table never becomes an argument at the counter.
 */
function stationHasMember(station: BoardStation | null): boolean {
  const session = station?.session;
  if (!session) return false;
  if (session.players.length > 0) return session.players.some((player) => player.customerType === "MEMBER");
  return session.customerType === "MEMBER";
}

export function FoodDialog({
  station,
  menu,
  currencySymbol,
  taxEnabled,
  open,
  onOpenChange,
  onDone,
}: {
  station: BoardStation | null;
  menu: MenuEntry[];
  currencySymbol: string;
  taxEnabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [pending, startTransition] = useTransition();

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of menu) map.set(item.categoryId, item.categoryName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [menu]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return menu.filter(
      (item) =>
        (activeCategory === "ALL" || item.categoryId === activeCategory) &&
        (term === "" || item.name.toLowerCase().includes(term)),
    );
  }, [menu, query, activeCategory]);

  const memberRates = stationHasMember(station);
  /** The price this station actually pays, used for every figure on screen. */
  const priceOf = (item: MenuEntry) =>
    memberRates && item.memberPrice !== null ? Math.min(item.memberPrice, item.price) : item.price;

  const lines = Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const item = menu.find((entry) => entry.id === id)!;
      const lineTotal = priceOf(item) * quantity;
      const tax = taxEnabled ? Math.round((lineTotal * item.taxPercent) / 100) : 0;
      return { item, quantity, lineTotal, tax };
    });

  const cartTotal = lines.reduce((sum, line) => sum + line.lineTotal + line.tax, 0);

  function change(id: string, delta: number) {
    setCart((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      return { ...current, [id]: next };
    });
  }

  function submit() {
    if (!station?.session || lines.length === 0) return;
    startTransition(async () => {
      const result = await addFoodOrderAction({
        sessionId: station.session!.id,
        items: lines.map((line) => ({ foodItemId: line.item.id, quantity: line.quantity })),
      });
      if (result.ok) {
        toast.success(`Food added — ${formatMoney(result.data.total, currencySymbol)}`);
        setCart({});
        onDone();
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function advanceStatus(orderId: string, next: "PREPARING" | "READY" | "SERVED") {
    startTransition(async () => {
      const result = await setFoodOrderStatusAction(orderId, next);
      if (result.ok) {
        toast.success(`Order marked ${next.toLowerCase()}`);
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  function cancelOrder(orderId: string) {
    startTransition(async () => {
      const result = await cancelFoodOrderAction(orderId);
      if (result.ok) {
        toast.success("Order cancelled and removed from the bill");
        onDone();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (!station?.session) return null;

  const existingOrders = groupOrders(station);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={`Add food · ${station.code}`}
          description={`${station.session.customerName ?? "Walk-in"} · running food total ${formatMoney(
            station.session.foodAmount + station.session.foodTaxAmount,
            currencySymbol,
          )}`}
        />

        <DialogBody className="space-y-4">
          {memberRates ? (
            <p className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
              <BadgeCheck className="size-4 shrink-0" aria-hidden />
              Member prices — this station has a member, so anything with a member price is
              charged at it.
            </p>
          ) : null}

          {menu.length === 0 ? (
            <EmptyState
              title="The menu is empty"
              description="Add items under Food Menu before taking food orders."
            />
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search the menu…"
                  className="pl-9"
                  aria-label="Search menu"
                />
              </div>

              <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                <CategoryChip
                  label="All"
                  active={activeCategory === "ALL"}
                  onClick={() => setActiveCategory("ALL")}
                />
                {categories.map((category) => (
                  <CategoryChip
                    key={category.id}
                    label={category.name}
                    active={activeCategory === category.id}
                    onClick={() => setActiveCategory(category.id)}
                  />
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {filtered.map((item) => {
                  const quantity = cart[item.id] ?? 0;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                        quantity > 0 ? "border-gold/50 bg-gold/5" : "border-line bg-surface-2",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                        <p className="tabular text-xs text-ink-muted">
                          {memberRates && item.memberPrice !== null && item.memberPrice < item.price ? (
                            <>
                              <span className="mr-1 text-xs font-normal text-ink-faint line-through">
                                {formatMoney(item.price, currencySymbol)}
                              </span>
                              <span className="text-ok">{formatMoney(item.memberPrice, currencySymbol)}</span>
                            </>
                          ) : (
                            formatMoney(item.price, currencySymbol)
                          )}
                          {taxEnabled && item.taxPercent > 0 ? ` + ${item.taxPercent}% tax` : ""}
                        </p>
                      </div>
                      {quantity > 0 ? (
                        <div className="flex items-center gap-1">
                          <Button variant="secondary" size="icon" onClick={() => change(item.id, -1)} aria-label={`Remove one ${item.name}`}>
                            <Minus />
                          </Button>
                          <span className="tabular w-7 text-center text-sm font-bold text-gold">{quantity}</span>
                          <Button variant="secondary" size="icon" onClick={() => change(item.id, 1)} aria-label={`Add one ${item.name}`}>
                            <Plus />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => change(item.id, 1)}>
                          <Plus aria-hidden />
                          Add
                        </Button>
                      )}
                    </div>
                  );
                })}
                {filtered.length === 0 ? (
                  <p className="col-span-full py-6 text-center text-sm text-ink-muted">No items match that search.</p>
                ) : null}
              </div>
            </>
          )}

          {existingOrders.length > 0 ? (
            <div className="rounded-lg border border-line">
              <p className="border-b border-line px-3 py-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                Already on this bill
              </p>
              <ul className="divide-y divide-line">
                {existingOrders.map((order) => (
                  <li key={order.orderId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{order.summary}</p>
                      <p className="text-xs text-ink-faint">{order.orderCode}</p>
                    </div>
                    <FoodStatusBadge status={order.status} />
                    {NEXT_STATUS[order.status as keyof typeof NEXT_STATUS] ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          advanceStatus(order.orderId, NEXT_STATUS[order.status as keyof typeof NEXT_STATUS])
                        }
                      >
                        Mark {NEXT_STATUS[order.status as keyof typeof NEXT_STATUS].toLowerCase()}
                      </Button>
                    ) : null}
                    <span className="tabular text-sm font-semibold text-ink">
                      {formatMoney(order.total, currencySymbol)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => cancelOrder(order.orderId)}
                      disabled={pending}
                      aria-label={`Cancel order ${order.orderCode}`}
                      title="Cancel this order"
                    >
                      <Trash2 className="text-danger" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <div className="text-sm">
            <span className="text-ink-muted">New items </span>
            <span className="tabular text-lg font-bold text-gold">{formatMoney(cartTotal, currencySymbol)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Close
            </Button>
            <Button onClick={submit} loading={pending} disabled={lines.length === 0}>
              Add to bill
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-gold bg-gold/15 text-gold"
          : "border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

function groupOrders(station: BoardStation) {
  const session = station.session;
  if (!session) return [];
  const map = new Map<string, { orderId: string; orderCode: string; status: string; total: number; parts: string[] }>();
  for (const line of session.foodLines) {
    const entry = map.get(line.orderId) ?? {
      orderId: line.orderId,
      orderCode: line.orderCode,
      status: line.status,
      total: 0,
      parts: [],
    };
    entry.total += line.lineTotal + line.taxAmount;
    entry.parts.push(`${line.name} × ${line.quantity}`);
    map.set(line.orderId, entry);
  }
  return [...map.values()].map((entry) => ({ ...entry, summary: entry.parts.join(", ") }));
}
