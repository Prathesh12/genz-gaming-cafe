"use client";

import { useActionState, useEffect, useState } from "react";

import { UserRound, Users } from "lucide-react";
import { toast } from "sonner";

import { MemberPicker, isLapsed, type MemberHit } from "@/components/members/member-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { startSessionAction } from "@/server/actions/sessions";
import type { BoardStation } from "@/server/services/stations";

const QUICK_DURATIONS = [30, 60, 120, 180, 240];

/**
 * A seat is a member or a guest. `null` means nobody has been picked for that
 * seat yet, which is exactly how a walk-in is recorded — they pay regular rates.
 */
type Seat = MemberHit | null;

export function StartSessionDialog({
  station,
  currencySymbol,
  open,
  onOpenChange,
  onStarted,
}: {
  station: BoardStation | null;
  currencySymbol: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}) {
  const [state, formAction, pending] = useActionState(startSessionAction, null);
  const [seats, setSeats] = useState<Seat[]>([null]);
  const [planned, setPlanned] = useState<string>("");

  useEffect(() => {
    if (state?.ok) {
      toast.success(`Session started on ${station?.code ?? "station"}`);
      onOpenChange(false);
      onStarted();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!station) return null;

  const maxPlayers = Math.max(1, station.maxPlayers);
  const shared = maxPlayers > 1;

  /** Grow or shrink the roster, keeping the members already picked. */
  function setPlayerCount(count: number) {
    setSeats((current) => {
      if (count === current.length) return current;
      if (count < current.length) return current.slice(0, count);
      return [...current, ...Array.from({ length: count - current.length }, () => null as Seat)];
    });
  }

  function setSeat(index: number, member: Seat) {
    setSeats((current) => current.map((seat, position) => (position === index ? member : seat)));
  }

  const pickedIds = seats.filter((seat): seat is MemberHit => Boolean(seat)).map((seat) => seat.id);
  const memberSeats = seats.filter((seat) => !isLapsed(seat)).length;
  const guestSeats = seats.length - memberSeats;

  // What the counter will collect per hour, at the rates showing on the card.
  const memberRate = station.memberHourlyRate ?? station.hourlyRate;
  const estimate =
    station.hourlyRate === null
      ? null
      : memberSeats * (memberRate ?? station.hourlyRate) + guestSeats * station.hourlyRate;

  /**
   * The roster travels as JSON in one field. `memberId` is sent separately as
   * well so a single-seat session posts exactly the shape it always did.
   */
  const playersJson = JSON.stringify(
    seats.map((seat) => ({ memberId: seat ? seat.id : null, name: seat ? seat.fullName : null })),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={`Start session · ${station.code}`}
          description={`${station.name} · ${station.categoryName}`}
        />
        <DialogForm action={formAction}>
          <input type="hidden" name="stationId" value={station.id} />
          <input type="hidden" name="memberId" value={seats[0] && !isLapsed(seats[0]) ? seats[0].id : ""} />
          <input type="hidden" name="players" value={playersJson} />
          <input
            type="hidden"
            name="reservationId"
            value={station.upcomingReservation ? station.upcomingReservation.id : ""}
          />

          <DialogBody className="space-y-4">
            {/* ------------------------- Rate summary ------------------------ */}
            <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5">
              <span className="text-sm text-ink-muted">
                {shared
                  ? `${memberSeats} at member rate · ${guestSeats} at regular rate`
                  : memberSeats > 0
                    ? "Member rate"
                    : "Regular rate"}
              </span>
              <span className="tabular text-lg font-bold text-gold">
                {estimate === null ? "No pricing" : `${formatMoney(estimate, currencySymbol)}/hr`}
              </span>
            </div>

            {/* -------------------------- Players ---------------------------- */}
            {shared ? (
              <Field
                label="How many are playing?"
                hint="Each player is charged their own rate — members pay member prices, everyone else pays regular prices."
              >
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: maxPlayers }, (_, index) => index + 1).map((count) => (
                    <button
                      type="button"
                      key={count}
                      onClick={() => setPlayerCount(count)}
                      aria-pressed={seats.length === count}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-lg border text-base font-semibold transition-colors",
                        seats.length === count
                          ? "border-gold bg-gold/15 text-gold"
                          : "border-line bg-surface-2 text-ink-muted hover:border-line-strong hover:text-ink",
                      )}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </Field>
            ) : null}

            <div className="space-y-3">
              {seats.map((seat, index) => (
                <Field
                  key={index}
                  label={shared ? `Player ${index + 1}` : "Member (optional)"}
                  htmlFor={index === 0 ? "member-search" : undefined}
                  hint={
                    index === 0 && !shared
                      ? "Search by name, mobile or member ID."
                      : seat
                        ? undefined
                        : "Leave blank for a guest at regular rates."
                  }
                >
                  <MemberPicker
                    value={seat}
                    onChange={(member) => setSeat(index, member)}
                    excludeIds={pickedIds.filter((id) => id !== seat?.id)}
                    inputId={index === 0 ? "member-search" : undefined}
                    placeholder={shared ? `Search a member for player ${index + 1}…` : "Search members…"}
                  />
                </Field>
              ))}
            </div>

            {shared && guestSeats > 0 ? (
              <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-muted">
                <Users className="size-4 shrink-0 text-ink-faint" aria-hidden />
                {guestSeats === 1 ? "One seat is" : `${guestSeats} seats are`} on the regular rate — a
                guest, or a membership that has lapsed. Pick an active member for a seat to switch that
                person to member pricing.
              </p>
            ) : null}

            {/* ------------------------ Walk-in details ---------------------- */}
            {!seats[0] ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer name" htmlFor="customerName" hint="Optional — leave blank for walk-ins.">
                  <Input id="customerName" name="customerName" placeholder="Walk-in" autoComplete="off" />
                </Field>
                <Field label="Mobile" htmlFor="customerMobile" hint="Optional.">
                  <Input
                    id="customerMobile"
                    name="customerMobile"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="9876543210"
                    autoComplete="off"
                  />
                </Field>
              </div>
            ) : null}

            {/* -------------------------- Duration --------------------------- */}
            <Field
              label="Planned duration (optional)"
              hint="Only a reminder — billing always follows the actual time played."
            >
              <div className="flex flex-wrap gap-2">
                {QUICK_DURATIONS.map((minutes) => (
                  <button
                    type="button"
                    key={minutes}
                    onClick={() => setPlanned(planned === String(minutes) ? "" : String(minutes))}
                    className={
                      planned === String(minutes)
                        ? "rounded-lg border border-gold bg-gold/15 px-3 py-2 text-sm font-semibold text-gold"
                        : "rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
                    }
                  >
                    {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                  </button>
                ))}
                <Input
                  name="plannedMinutes"
                  value={planned}
                  onChange={(event) => setPlanned(event.target.value.replace(/\D/g, ""))}
                  placeholder="Custom min"
                  inputMode="numeric"
                  className="w-32"
                  aria-label="Custom planned minutes"
                />
              </div>
            </Field>

            <Field label="Note (optional)" htmlFor="notes">
              <Input id="notes" name="notes" placeholder="e.g. tournament practice" autoComplete="off" />
            </Field>

            {state?.ok === false ? (
              <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                {state.error}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" size="lg" loading={pending} disabled={station.hourlyRate === null}>
              {shared && seats.length > 1 ? (
                <>
                  <UserRound aria-hidden />
                  Start for {seats.length} players
                </>
              ) : (
                "Start session"
              )}
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}
