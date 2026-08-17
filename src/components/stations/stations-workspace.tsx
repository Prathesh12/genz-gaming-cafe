"use client";

import { useMemo, useState, useTransition } from "react";

import { LayoutGrid, Search, Settings2, Users, Wrench } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { CheckoutDialog } from "@/components/stations/checkout-dialog";
import { EditPlayersDialog } from "@/components/stations/edit-players-dialog";
import { FoodDialog, type MenuEntry } from "@/components/stations/food-dialog";
import { StartSessionDialog } from "@/components/stations/start-session-dialog";
import { StationCard, type StationCardAction } from "@/components/stations/station-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useNow, usePolling } from "@/hooks/use-live";
import { formatMoney } from "@/lib/money";
import { formatDurationHuman } from "@/lib/time";
import { cn } from "@/lib/utils";
import { setStationStatusAction } from "@/server/actions/stations";
import { addTimeAction, cancelSessionAction, pauseSessionAction, resumeSessionAction } from "@/server/actions/sessions";
import type { StationBoard } from "@/server/services/stations";

type StatusFilter = "ALL" | "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "AVAILABLE", label: "Available" },
  { value: "OCCUPIED", label: "Occupied" },
  { value: "RESERVED", label: "Reserved" },
  { value: "MAINTENANCE", label: "Maintenance" },
];

const ADD_TIME_OPTIONS = [30, 60, 120];

export function StationsWorkspace({
  board,
  menu,
  canManage,
  canDiscount,
  discountLimit,
}: {
  board: StationBoard;
  menu: MenuEntry[];
  canManage: boolean;
  canDiscount: boolean;
  discountLimit: number;
}) {
  const router = useRouter();
  const now = useNow(1000);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [categoryId, setCategoryId] = useState("ALL");
  const [pending, startTransition] = useTransition();

  const [startFor, setStartFor] = useState<string | null>(null);
  const [foodFor, setFoodFor] = useState<string | null>(null);
  const [checkoutFor, setCheckoutFor] = useState<string | null>(null);
  const [addTimeFor, setAddTimeFor] = useState<string | null>(null);
  const [maintenanceFor, setMaintenanceFor] = useState<string | null>(null);
  const [detailsFor, setDetailsFor] = useState<string | null>(null);
  const [playersFor, setPlayersFor] = useState<string | null>(null);
  const [maintenanceReason, setMaintenanceReason] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  /**
   * Background polling is paused while any dialog is open. Refreshing under an
   * open checkout would re-render the form and lose half-typed amounts.
   */
  const dialogOpen = Boolean(
    startFor || foodFor || checkoutFor || addTimeFor || maintenanceFor || detailsFor || playersFor,
  );
  usePolling(12_000, !dialogOpen);

  const byId = useMemo(() => new Map(board.stations.map((station) => [station.id, station])), [board.stations]);
  const categoryById = useMemo(
    () => new Map(board.categories.map((category) => [category.id, category])),
    [board.categories],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return board.stations.filter((station) => {
      const effectiveStatus = station.session ? "OCCUPIED" : station.status;
      if (status !== "ALL" && effectiveStatus !== status) return false;
      if (categoryId !== "ALL" && station.categoryId !== categoryId) return false;
      if (
        term &&
        !`${station.code} ${station.name} ${station.categoryName} ${station.session?.customerName ?? ""}`
          .toLowerCase()
          .includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [board.stations, query, status, categoryId]);

  const counts = useMemo(() => {
    const result = { ALL: board.stations.length, AVAILABLE: 0, OCCUPIED: 0, RESERVED: 0, MAINTENANCE: 0 };
    for (const station of board.stations) {
      const effective = station.session ? "OCCUPIED" : station.status;
      result[effective as keyof typeof result] += 1;
    }
    return result;
  }, [board.stations]);

  function refresh() {
    router.refresh();
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(successMessage);
        refresh();
      } else {
        toast.error(result.error ?? "Something went wrong.");
      }
    });
  }

  function handleAction(action: StationCardAction) {
    const station = action.station;
    switch (action.type) {
      case "start":
        setStartFor(station.id);
        break;
      case "food":
        setFoodFor(station.id);
        break;
      case "addTime":
        setCustomMinutes("");
        setAddTimeFor(station.id);
        break;
      case "checkout":
        setCheckoutFor(station.id);
        break;
      case "pause":
        if (station.session) run(() => pauseSessionAction(station.session!.id), "Session paused — billing stopped");
        break;
      case "resume":
        if (station.session) run(() => resumeSessionAction(station.session!.id), "Session resumed");
        break;
      case "details":
        setCancelReason("");
        setDetailsFor(station.id);
        break;
      case "maintenance":
        setMaintenanceReason(station.maintenanceReason ?? "");
        setMaintenanceFor(station.id);
        break;
      case "reserve":
        router.push(`/reservations?station=${station.id}`);
        break;
    }
  }

  const startStation = startFor ? (byId.get(startFor) ?? null) : null;
  const foodStation = foodFor ? (byId.get(foodFor) ?? null) : null;
  const checkoutStation = checkoutFor ? (byId.get(checkoutFor) ?? null) : null;
  const addTimeStation = addTimeFor ? (byId.get(addTimeFor) ?? null) : null;
  const maintenanceStation = maintenanceFor ? (byId.get(maintenanceFor) ?? null) : null;
  const detailsStation = detailsFor ? (byId.get(detailsFor) ?? null) : null;
  const playersStation = playersFor ? (byId.get(playersFor) ?? null) : null;

  return (
    <div className="space-y-4">
      {/* ------------------------------ Toolbar ------------------------------ */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search station or customer…"
              className="pl-9"
              aria-label="Search stations"
            />
          </div>
          {canManage ? (
            <Button variant="secondary" asChild>
              <Link href="/stations/manage">
                <Settings2 aria-hidden />
                Manage
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatus(filter.value)}
              aria-pressed={status === filter.value}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                status === filter.value
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {filter.label}
              <span className="tabular rounded bg-black/30 px-1.5 text-xs">{counts[filter.value]}</span>
            </button>
          ))}
        </div>

        {board.categories.length > 0 ? (
          <div className="scrollbar-slim -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <button
              onClick={() => setCategoryId("ALL")}
              aria-pressed={categoryId === "ALL"}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                categoryId === "ALL"
                  ? "border-ink-muted bg-surface-3 text-ink"
                  : "border-line bg-surface-2 text-ink-muted hover:text-ink",
              )}
            >
              All categories
            </button>
            {board.categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setCategoryId(category.id)}
                aria-pressed={categoryId === category.id}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  categoryId === category.id
                    ? "border-ink-muted bg-surface-3 text-ink"
                    : "border-line bg-surface-2 text-ink-muted hover:text-ink",
                )}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: category.color }} aria-hidden />
                {category.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* -------------------------------- Grid -------------------------------- */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="size-6" />}
          title={board.stations.length === 0 ? "No stations yet" : "Nothing matches those filters"}
          description={
            board.stations.length === 0
              ? "Add your PCs, consoles and simulators to start taking sessions."
              : "Try a different status, category or search term."
          }
          action={
            board.stations.length === 0 && canManage ? (
              <Button asChild>
                <Link href="/stations/manage">Add your first station</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              category={categoryById.get(station.categoryId)}
              config={board.pricingConfig}
              currencySymbol={board.currencySymbol}
              now={now}
              canManage={canManage}
              busy={pending}
              onAction={handleAction}
            />
          ))}
        </div>
      )}

      {/* ------------------------------ Dialogs ------------------------------ */}
      <StartSessionDialog
        station={startStation}
        currencySymbol={board.currencySymbol}
        open={Boolean(startStation)}
        onOpenChange={(open) => !open && setStartFor(null)}
        onStarted={refresh}
      />

      <FoodDialog
        station={foodStation}
        menu={menu}
        currencySymbol={board.currencySymbol}
        taxEnabled={board.taxEnabled}
        open={Boolean(foodStation?.session)}
        onOpenChange={(open) => !open && setFoodFor(null)}
        onDone={refresh}
      />

      <CheckoutDialog
        station={checkoutStation}
        currencySymbol={board.currencySymbol}
        canDiscount={canDiscount}
        discountLimit={discountLimit}
        open={Boolean(checkoutStation?.session)}
        onOpenChange={(open) => !open && setCheckoutFor(null)}
        onDone={refresh}
      />

      {/* Add time */}
      <Dialog open={Boolean(addTimeStation)} onOpenChange={(open) => !open && setAddTimeFor(null)}>
        <DialogContent size="sm">
          <DialogHeader
            title={`Add time · ${addTimeStation?.code ?? ""}`}
            description="Extends the same session — no new session is created."
          />
          <DialogBody className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {ADD_TIME_OPTIONS.map((minutes) => (
                <Button
                  key={minutes}
                  variant="secondary"
                  size="lg"
                  disabled={pending}
                  onClick={() => {
                    const sessionId = addTimeStation?.session?.id;
                    if (!sessionId) return;
                    run(() => addTimeAction(sessionId, minutes), `Added ${formatDurationHuman(minutes)}`);
                    setAddTimeFor(null);
                  }}
                >
                  {minutes >= 60 ? `${minutes / 60} hr` : `${minutes} min`}
                </Button>
              ))}
            </div>
            <Field label="Custom minutes" htmlFor="customMinutes">
              <Input
                id="customMinutes"
                value={customMinutes}
                onChange={(event) => setCustomMinutes(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="e.g. 45"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTimeFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!customMinutes || pending}
              onClick={() => {
                const sessionId = addTimeStation?.session?.id;
                if (!sessionId) return;
                run(() => addTimeAction(sessionId, Number(customMinutes)), `Added ${customMinutes} minutes`);
                setAddTimeFor(null);
              }}
            >
              Add time
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Maintenance */}
      <Dialog open={Boolean(maintenanceStation)} onOpenChange={(open) => !open && setMaintenanceFor(null)}>
        <DialogContent size="sm">
          <DialogHeader
            title={`${maintenanceStation?.status === "MAINTENANCE" ? "Return to service" : "Mark maintenance"} · ${maintenanceStation?.code ?? ""}`}
          />
          <DialogBody>
            {maintenanceStation?.status === "MAINTENANCE" ? (
              <p className="text-sm text-ink-muted">
                {maintenanceStation.code} will become available for new sessions immediately.
              </p>
            ) : (
              <Field label="Reason" htmlFor="maintenanceReason" hint="Shown on the station card.">
                <Textarea
                  id="maintenanceReason"
                  value={maintenanceReason}
                  onChange={(event) => setMaintenanceReason(event.target.value)}
                  placeholder="e.g. GPU issue, controller replacement"
                />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMaintenanceFor(null)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() => {
                if (!maintenanceStation) return;
                const toMaintenance = maintenanceStation.status !== "MAINTENANCE";
                run(
                  () =>
                    setStationStatusAction({
                      stationId: maintenanceStation.id,
                      status: toMaintenance ? "MAINTENANCE" : "AVAILABLE",
                      maintenanceReason: toMaintenance ? maintenanceReason : null,
                    }),
                  toMaintenance ? "Station marked for maintenance" : "Station is available again",
                );
                setMaintenanceFor(null);
              }}
            >
              <Wrench aria-hidden />
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditPlayersDialog
        key={playersStation?.session?.id ?? "no-players"}
        station={playersStation}
        open={Boolean(playersStation)}
        onOpenChange={(open) => !open && setPlayersFor(null)}
        onSaved={refresh}
      />

      {/* Session details */}
      <Dialog open={Boolean(detailsStation)} onOpenChange={(open) => !open && setDetailsFor(null)}>
        <DialogContent size="md">
          <DialogHeader title={`Session · ${detailsStation?.code ?? ""}`} description={detailsStation?.session?.code} />
          <DialogBody className="space-y-3 text-sm">
            {detailsStation?.session ? (
              <>
                {detailsStation.session.playerCount > 1 ? (
                  <div className="rounded-lg border border-line">
                    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                      <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                        {detailsStation.session.playerCount} players
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDetailsFor(null);
                          setPlayersFor(detailsStation.id);
                        }}
                      >
                        <Users aria-hidden />
                        Edit players
                      </Button>
                    </div>
                    <ul className="divide-y divide-line">
                      {detailsStation.session.players.map((player) => (
                        <li key={player.slot} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span className="min-w-0 truncate text-ink">
                            {player.slot}. {player.label}
                          </span>
                          <span
                            className={
                              player.customerType === "MEMBER"
                                ? "shrink-0 text-xs font-semibold text-ok"
                                : "shrink-0 text-xs text-ink-faint"
                            }
                          >
                            {player.customerType === "MEMBER" ? "Member rate" : "Regular rate"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <>
                    <DetailRow label="Customer" value={detailsStation.session.customerName ?? "Walk-in"} />
                    <DetailRow label="Mobile" value={detailsStation.session.customerMobile ?? "—"} />
                    <DetailRow
                      label="Rate type"
                      value={detailsStation.session.customerType === "MEMBER" ? "Member" : "Regular"}
                    />
                    {detailsStation.session.memberCode ? (
                      <DetailRow
                        label="Member"
                        value={`${detailsStation.session.memberName} (${detailsStation.session.memberCode})`}
                      />
                    ) : null}
                    {detailsStation.maxPlayers > 1 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setDetailsFor(null);
                          setPlayersFor(detailsStation.id);
                        }}
                      >
                        <Users aria-hidden />
                        Add players
                      </Button>
                    ) : null}
                  </>
                )}
                <DetailRow
                  label="Started"
                  value={new Date(detailsStation.session.startedAt).toLocaleString("en-IN")}
                />
                <DetailRow label="Started by" value={detailsStation.session.startedByName} />
                <DetailRow
                  label="Planned"
                  value={detailsStation.session.plannedMinutes ? formatDurationHuman(detailsStation.session.plannedMinutes) : "—"}
                />
                <DetailRow
                  label="Food so far"
                  value={formatMoney(
                    detailsStation.session.foodAmount + detailsStation.session.foodTaxAmount,
                    board.currencySymbol,
                  )}
                />
                {canManage ? (
                  <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
                    <p className="text-xs font-semibold tracking-wide text-danger uppercase">Cancel session</p>
                    <p className="text-xs text-ink-muted">
                      Use only for a mistaken start. Nothing is charged and the station is freed. Sessions with food
                      orders cannot be cancelled.
                    </p>
                    <Input
                      value={cancelReason}
                      onChange={(event) => setCancelReason(event.target.value)}
                      placeholder="Reason"
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending || cancelReason.trim().length < 3}
                      onClick={() => {
                        const sessionId = detailsStation.session?.id;
                        if (!sessionId) return;
                        run(() => cancelSessionAction(sessionId, cancelReason), "Session cancelled");
                        setDetailsFor(null);
                      }}
                    >
                      Cancel this session
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-ink-muted">This station has no live session.</p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsFor(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-2 last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}
