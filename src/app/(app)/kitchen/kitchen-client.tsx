"use client";

import { useTransition } from "react";

import { ChefHat } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { FoodStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { useNow } from "@/hooks/use-live";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { setFoodOrderStatusAction } from "@/server/actions/food";

const NEXT_STATUS = {
  ORDERED: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
} as const;

export type KitchenOrder = {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  sessionCode: string;
  stationLabel: string;
  items: string;
  total: number;
};

/**
 * The kitchen queue: every food order that has not been served yet, oldest at
 * the bottom. Designed to be left open on a screen in the kitchen — it refreshes
 * itself and each order advances with a single large tap.
 */
export function KitchenClient({
  orders,
  currencySymbol,
}: {
  orders: KitchenOrder[];
  currencySymbol: string;
}) {
  const router = useRouter();
  const now = useNow(30_000);
  const [pending, startTransition] = useTransition();

  function advance(order: KitchenOrder) {
    const next = NEXT_STATUS[order.status as keyof typeof NEXT_STATUS];
    if (!next) return;
    startTransition(async () => {
      const result = await setFoodOrderStatusAction(order.id, next);
      if (result.ok) {
        toast.success(`${order.code} marked ${next.toLowerCase()}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<ChefHat className="size-6" />}
        title="Nothing in the queue"
        description="Food orders taken at a station appear here until they are served."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {orders.map((order) => {
        const next = NEXT_STATUS[order.status as keyof typeof NEXT_STATUS];
        // `now` is null on the server render, so the wait time appears on hydration.
        const waitedMinutes = now
          ? Math.max(0, Math.round((now.getTime() - new Date(order.createdAt).getTime()) / 60_000))
          : null;
        return (
          <Card
            key={order.id}
            className={cn(
              order.status === "READY" && "border-info/50",
              order.status === "PREPARING" && "border-warn/50",
              waitedMinutes !== null && waitedMinutes >= 20 && order.status !== "READY" && "border-danger/60",
            )}
          >
            <CardContent className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-ink">{order.stationLabel}</p>
                  <p className="truncate font-mono text-xs text-ink-faint">{order.code}</p>
                </div>
                <FoodStatusBadge status={order.status} />
              </div>

              <p className="text-sm text-ink">{order.items}</p>

              <div className="flex items-center justify-between text-xs">
                <span
                  className={cn(
                    "tabular",
                    waitedMinutes !== null && waitedMinutes >= 20 ? "font-semibold text-danger" : "text-ink-faint",
                  )}
                >
                  {waitedMinutes === null ? "just now" : `waiting ${waitedMinutes} min`}
                </span>
                <span className="tabular font-semibold text-gold">{formatMoney(order.total, currencySymbol)}</span>
              </div>

              {next ? (
                <Button size="touch" className="mt-auto" disabled={pending} onClick={() => advance(order)}>
                  Mark {next.toLowerCase()}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
