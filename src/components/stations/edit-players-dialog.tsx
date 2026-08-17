"use client";

import { useState, useTransition } from "react";

import { Info } from "lucide-react";
import { toast } from "sonner";

import { MemberPicker, isLapsed, type MemberHit } from "@/components/members/member-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { setSessionPlayersAction } from "@/server/actions/sessions";
import type { BoardPlayer, BoardStation } from "@/server/services/stations";

type Seat = MemberHit | null;

/**
 * The board carries only what it needs to draw a card, so a player already on
 * the station is turned back into something the picker can display. `mobile` is
 * left blank deliberately — it is not on the board and is not needed to
 * identify someone already chosen.
 */
function seatFromBoard(player: BoardPlayer): Seat {
  if (!player.memberId) return null;
  return {
    id: player.memberId,
    memberCode: player.memberCode ?? "",
    fullName: player.label,
    mobile: "",
    validUntil: player.membershipValidUntil,
    membershipStatus: player.customerType === "MEMBER" ? "ACTIVE" : "EXPIRED",
    daysRemaining: null,
  };
}

/**
 * Change who is on a station that is already running — a friend joined, or the
 * wrong member was picked at the start. Everyone listed is billed for the whole
 * session, which the dialog says plainly so it can never surprise anyone at
 * checkout.
 */
export function EditPlayersDialog({
  station,
  open,
  onOpenChange,
  onSaved,
}: {
  station: BoardStation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const session = station?.session ?? null;
  const [seats, setSeats] = useState<Seat[]>(() => (session ? session.players.map(seatFromBoard) : [null]));
  const [pending, startTransition] = useTransition();

  if (!station || !session) return null;

  const maxPlayers = Math.max(1, station.maxPlayers);

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

  function save() {
    const sessionId = session?.id;
    if (!sessionId) return;
    startTransition(async () => {
      const result = await setSessionPlayersAction(
        sessionId,
        seats.map((seat) => ({ memberId: seat ? seat.id : null, name: seat ? seat.fullName : null })),
      );
      if (result.ok) {
        toast.success("Players updated");
        onOpenChange(false);
        onSaved();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title={`Players · ${station.code}`}
          description={`${station.name} · ${station.categoryName}`}
        />
        <DialogBody className="space-y-4">
          <p className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Everyone listed here is billed for the whole session, from the time it started. There is no
            separate clock per player.
          </p>

          {maxPlayers > 1 ? (
            <Field label="How many are playing?">
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
                label={`Player ${index + 1}`}
                hint={seat ? undefined : "Leave blank for a guest at regular rates."}
              >
                <MemberPicker
                  value={seat}
                  onChange={(member) => setSeat(index, member)}
                  excludeIds={pickedIds.filter((id) => id !== seat?.id)}
                  placeholder={`Search a member for player ${index + 1}…`}
                />
              </Field>
            ))}
          </div>

          <p className="text-xs text-ink-muted">
            {memberSeats} of {seats.length} on member rates.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            Save players
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
