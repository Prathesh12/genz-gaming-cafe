"use client";

import { useActionState, useEffect, useState, useTransition } from "react";

import { CalendarClock, Plus, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogForm, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cancelReservationAction, markNoShowAction, saveReservationAction } from "@/server/actions/admin";

type Reservation = {
  id: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  categoryName: string;
  customerName: string;
  mobile: string | null;
  startTime: string;
  endTime: string;
  notes: string | null;
  status: string;
};

const STATUS_TONE: Record<string, BadgeProps["tone"]> = {
  BOOKED: "info",
  STARTED: "gold",
  COMPLETED: "ok",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

export function ReservationsClient({
  reservations,
  stations,
}: {
  reservations: Reservation[];
  stations: { id: string; code: string; name: string; categoryName: string; status: string }[];
}) {
  const router = useRouter();
  const presetStationParam = useSearchParams().get("station") ?? "";
  // Arriving from a station card ("Reserve") opens the form straight away.
  const [dialogOpen, setDialogOpen] = useState(Boolean(presetStationParam));
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [pending, startTransition] = useTransition();
  const presetStation = presetStationParam;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          Bookings block the station for that window — overlapping bookings are rejected automatically.
        </p>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus aria-hidden />
          New booking
        </Button>
      </div>

      {reservations.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="No upcoming bookings"
          description="Reserve a station for a customer and start their session with one tap when they arrive."
          action={<Button onClick={() => setDialogOpen(true)}>Create a booking</Button>}
        />
      ) : (
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Station</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Status</TH>
                <TH>Notes</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {reservations.map((reservation) => (
                <TR key={reservation.id}>
                  <TD>
                    <span className="font-medium text-ink">{reservation.customerName}</span>
                    {reservation.mobile ? (
                      <span className="tabular block text-xs text-ink-faint">{reservation.mobile}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <span className="font-medium text-ink">{reservation.stationCode}</span>
                    <span className="block text-xs text-ink-faint">{reservation.categoryName}</span>
                  </TD>
                  <TD className="tabular">{formatDateTime(reservation.startTime)}</TD>
                  <TD className="tabular">{formatDateTime(reservation.endTime)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[reservation.status] ?? "neutral"}>{reservation.status.replace("_", " ")}</Badge>
                  </TD>
                  <TD className="max-w-48 truncate text-ink-muted">{reservation.notes ?? "—"}</TD>
                  <TD className="text-right">
                    {reservation.status === "BOOKED" ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            startTransition(async () => {
                              const result = await markNoShowAction(reservation.id);
                              if (result.ok) {
                                toast.success("Marked as no-show");
                                router.refresh();
                              } else toast.error(result.error);
                            })
                          }
                        >
                          No-show
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setCancelling(reservation)}
                          aria-label="Cancel booking"
                        >
                          <X className="text-danger" />
                        </Button>
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}

      <ReservationDialog
        open={dialogOpen}
        stations={stations}
        presetStation={presetStation}
        onClose={() => setDialogOpen(false)}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancel this booking?"
        description={
          cancelling
            ? `${cancelling.customerName}'s booking on ${cancelling.stationCode} will be released.`
            : ""
        }
        confirmLabel="Cancel booking"
        destructive
        loading={pending}
        onConfirm={() => {
          if (!cancelling) return;
          startTransition(async () => {
            const result = await cancelReservationAction(cancelling.id);
            if (result.ok) {
              toast.success("Booking cancelled");
              router.refresh();
            } else toast.error(result.error);
            setCancelling(null);
          });
        }}
      />
    </div>
  );
}

function ReservationDialog({
  open,
  stations,
  presetStation,
  onClose,
  onSaved,
}: {
  open: boolean;
  stations: { id: string; code: string; name: string; categoryName: string; status: string }[];
  presetStation: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveReservationAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Booking created");
      onSaved();
      onClose();
    } else if (state?.ok === false) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const now = new Date();
  const defaultStart = toLocalInput(new Date(now.getTime() + 30 * 60000));
  const defaultEnd = toLocalInput(new Date(now.getTime() + 90 * 60000));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <DialogHeader title="New booking" description="Times are in the cafe's local timezone." />
        <DialogForm action={formAction}>
          <DialogBody className="space-y-4">
            <Field label="Station" htmlFor="r-station" required>
              <NativeSelect id="r-station" name="stationId" defaultValue={presetStation} required>
                <option value="">Choose a station…</option>
                {stations.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.code} — {station.name} ({station.categoryName})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Customer name" htmlFor="r-name" required>
                <Input id="r-name" name="customerName" required />
              </Field>
              <Field label="Mobile" htmlFor="r-mobile">
                <Input id="r-mobile" name="mobile" inputMode="numeric" maxLength={10} />
              </Field>
              <Field label="From" htmlFor="r-start" required>
                <Input id="r-start" name="startTime" type="datetime-local" defaultValue={defaultStart} required />
              </Field>
              <Field
                label="To"
                htmlFor="r-end"
                required
                error={state?.ok === false ? state.fieldErrors?.endTime : undefined}
              >
                <Input id="r-end" name="endTime" type="datetime-local" defaultValue={defaultEnd} required />
              </Field>
            </div>
            <Field label="Notes" htmlFor="r-notes">
              <Textarea id="r-notes" name="notes" placeholder="e.g. 5-player squad, needs adjacent PCs" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Create booking
            </Button>
          </DialogFooter>
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
