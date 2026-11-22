"use client";

import { useMemo } from "react";

import { CalendarClock, Pause, Play, Plus, Users, UtensilsCrossed, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StationStatusBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatDurationHMS, formatDurationHuman } from "@/lib/time";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { priceRoomSession, priceSessionForPlayers, type PricingConfig } from "@/server/pricing/engine";
import type { BoardCategory, BoardStation } from "@/server/services/stations";

export type StationCardAction =
  | { type: "start"; station: BoardStation }
  | { type: "food"; station: BoardStation }
  | { type: "addTime"; station: BoardStation }
  | { type: "pause"; station: BoardStation }
  | { type: "resume"; station: BoardStation }
  | { type: "checkout"; station: BoardStation }
  | { type: "details"; station: BoardStation }
  | { type: "maintenance"; station: BoardStation }
  | { type: "reserve"; station: BoardStation };

/**
 * The card's colour treatment: a soft wash of the station's own colour rising
 * from the top edge, over the dark surface. Purely decorative — every number
 * and label keeps its normal contrast, and the status is still carried by the
 * badge text rather than by colour.
 */
function surfaceStyle(station: BoardStation): React.CSSProperties {
  const from = station.color;
  const to = station.colorStyle === "GRADIENT" ? station.colorAccent : station.color;
  return {
    backgroundImage: [
      // Coloured glow behind the header.
      `radial-gradient(130% 70% at 15% -10%, ${from}2e 0%, transparent 62%)`,
      `radial-gradient(120% 70% at 85% -10%, ${to}24 0%, transparent 58%)`,
      // Faint sheen so the panel is not flat black.
      "linear-gradient(165deg, rgba(255,255,255,0.05) 0%, transparent 42%)",
      // Base surface.
      "linear-gradient(180deg, #141414 0%, #0f0f0f 100%)",
    ].join(", "),
    borderColor: `${from}3d`,
  };
}

export function StationCard({
  station,
  category,
  config,
  currencySymbol,
  now,
  canManage,
  busy,
  onAction,
}: {
  station: BoardStation;
  category: BoardCategory | undefined;
  config: PricingConfig;
  currencySymbol: string;
  now: Date | null;
  canManage: boolean;
  busy: boolean;
  onAction: (action: StationCardAction) => void;
}) {
  const session = station.session;

  /**
   * The live bill is computed in the browser with the *same* pricing engine
   * the server uses at checkout, so the number on the card and the number on
   * the receipt can never disagree. With several people on the station each is
   * priced at their own rate and the totals are added, exactly as at checkout.
   */
  const live = useMemo(() => {
    if (!session || !now) return null;
    const startedAt = new Date(session.startedAt);
    try {
      const common = {
        startedAt,
        endedAt: now,
        pauses: session.pauses.map((pause) => ({
          pausedAt: new Date(pause.pausedAt),
          resumedAt: pause.resumedAt ? new Date(pause.resumedAt) : null,
        })),
        config,
      };
      const result = session.pricingModel === "ROOM"
        ? priceRoomSession({
            ...common,
            rules: session.pricingSnapshot?.rules ?? [],
            playerCount: session.playerCount,
          })
        : priceSessionForPlayers({
            ...common,
            rules: category?.rules ?? [],
            players: session.players.map((player) => ({
              slot: player.slot,
              label: player.label,
              customerType: player.customerType,
              membershipValidUntil: player.membershipValidUntil ? new Date(player.membershipValidUntil) : null,
            })),
          });
      return { amount: result.amount, billedMinutes: result.billedMinutes, error: null as string | null };
    } catch (error) {
      return {
        amount: 0,
        billedMinutes: 0,
        error: error instanceof Error ? error.message : "Pricing is not configured.",
      };
    }
  }, [session, now, category, config]);

  const elapsedSeconds = useMemo(() => {
    if (!session || !now) return 0;
    const start = new Date(session.startedAt).getTime();
    let pausedMs = 0;
    for (const pause of session.pauses) {
      const from = new Date(pause.pausedAt).getTime();
      const to = pause.resumedAt ? new Date(pause.resumedAt).getTime() : now.getTime();
      pausedMs += Math.max(0, to - from);
    }
    return Math.max(0, Math.floor((now.getTime() - start - pausedMs) / 1000));
  }, [session, now]);

  const foodTotal = session ? session.foodAmount + session.foodTaxAmount : 0;
  const total = (live?.amount ?? 0) + foodTotal;
  const overrun =
    session?.plannedMinutes && live ? live.billedMinutes > session.plannedMinutes : false;

  return (
    <div
      // A stable hook for tests, so restyling the card cannot break them.
      data-station-code={station.code}
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border transition-colors",
        session && "ring-1 ring-gold/25",
        station.status === "MAINTENANCE" && "ring-1 ring-warn/30",
      )}
      style={surfaceStyle(station)}
    >
      {/* Colour strip: the admin-picked station colour — a flat band, or a
          blend into the accent colour when the station is set to gradient. */}
      <div
        className="h-1.5 w-full"
        style={
          station.colorStyle === "GRADIENT"
            ? { backgroundImage: `linear-gradient(90deg, ${station.color} 0%, ${station.colorAccent} 100%)` }
            : { backgroundColor: station.color }
        }
        aria-hidden
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-lg leading-tight font-bold text-ink">{station.code}</p>
            <p className="truncate text-xs text-ink-muted">
              {station.name} · {station.playstationType ?? station.categoryName}
            </p>
          </div>
          <StationStatusBadge status={session?.status === "PAUSED" ? "PAUSED" : station.status} />
        </div>

        {session ? (
          <>
            <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2.5 backdrop-blur-[1px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                  {session.status === "PAUSED" ? "Paused at" : "Elapsed"}
                </span>
                <span
                  className={cn(
                    "tabular text-2xl font-bold",
                    session.status === "PAUSED" ? "text-warn" : "text-gold",
                    overrun && session.status !== "PAUSED" && "text-danger",
                  )}
                >
                  {now ? formatDurationHMS(elapsedSeconds) : "--:--:--"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
                <span>
                  Started{" "}
                  {new Date(session.startedAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {session.plannedMinutes ? (
                  <span className={cn(overrun && "font-semibold text-danger")}>
                    Planned {formatDurationHuman(session.plannedMinutes)}
                    {overrun ? " · over" : ""}
                  </span>
                ) : null}
              </div>
            </div>

            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Gaming</dt>
                <dd className="tabular font-semibold text-ink">
                  {live?.error ? <span className="text-xs text-danger">No pricing</span> : formatMoney(live?.amount ?? 0, currencySymbol)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Food</dt>
                <dd className="tabular font-semibold text-ink">{formatMoney(foodTotal, currencySymbol)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="tabular text-lg font-bold text-gold">{formatMoney(total, currencySymbol)}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
              {session.playerCount > 1 ? (
                <span className="flex min-w-0 items-center gap-1">
                  <Users className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {session.playerCount} players
                  </span>
                </span>
              ) : (
                <span className="truncate">
                  {session.customerName ?? "Walk-in"}
                  {session.pricingModel === "ROOM" ? " · Room rate" : session.customerType === "MEMBER" ? " · Member rate" : ""}
                </span>
              )}
            </div>

            <div className="mt-auto grid grid-cols-2 gap-2">
              <Button variant="secondary" size="md" onClick={() => onAction({ type: "food", station })} disabled={busy}>
                <UtensilsCrossed aria-hidden />
                Food
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => onAction({ type: "addTime", station })}
                disabled={busy}
              >
                <Plus aria-hidden />
                Add time
              </Button>
              {session.status === "PAUSED" ? (
                <Button variant="outline" size="md" onClick={() => onAction({ type: "resume", station })} disabled={busy}>
                  <Play aria-hidden />
                  Resume
                </Button>
              ) : (
                <Button variant="outline" size="md" onClick={() => onAction({ type: "pause", station })} disabled={busy}>
                  <Pause aria-hidden />
                  Pause
                </Button>
              )}
              <Button variant="outline" size="md" onClick={() => onAction({ type: "details", station })} disabled={busy}>
                Details
              </Button>
              <Button
                size="touch"
                className="col-span-2"
                onClick={() => onAction({ type: "checkout", station })}
                disabled={busy}
              >
                End session
              </Button>
            </div>
          </>
        ) : station.status === "MAINTENANCE" ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              <Wrench className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{station.maintenanceReason ?? "Out of service"}</span>
            </div>
            <div className="mt-auto">
              {canManage ? (
                <Button
                  variant="secondary"
                  size="touch"
                  onClick={() => onAction({ type: "maintenance", station })}
                  disabled={busy}
                >
                  Return to available
                </Button>
              ) : (
                <p className="text-xs text-ink-faint">A manager can return this room to service.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-2xl font-bold text-gold">
                {station.hourlyRate === null ? "—" : formatMoney(station.hourlyRate, currencySymbol)}
              </span>
              <span className="text-xs text-ink-muted">{station.pricingModel === "ROOM" ? " room price/hour · 1 player" : station.maxPlayers > 1 ? "/hr each" : "/hr"}</span>
              {station.memberHourlyRate !== null && station.memberHourlyRate !== station.hourlyRate ? (
                <span className="ml-auto text-xs text-ink-faint">
                  Member {formatMoney(station.memberHourlyRate, currencySymbol)}
                </span>
              ) : null}
            </div>

            {station.hourlyRate === null ? (
              <p className="text-xs text-danger">No pricing configured for {station.categoryName}.</p>
            ) : null}

            {station.upcomingReservation ? (
              <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {station.upcomingReservation.customerName} ·{" "}
                  {new Date(station.upcomingReservation.startTime).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ) : null}

            <div className="mt-auto flex flex-col gap-2">
              <Button size="touch" onClick={() => onAction({ type: "start", station })} disabled={busy}>
                <Play aria-hidden />
                Start session
              </Button>
              {canManage ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => onAction({ type: "reserve", station })}>
                    <CalendarClock aria-hidden />
                    Reserve
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onAction({ type: "maintenance", station })}>
                    <Wrench aria-hidden />
                    Maintenance
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
