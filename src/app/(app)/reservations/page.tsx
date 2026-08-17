import type { Metadata } from "next";
import { Suspense } from "react";

import { LoadingState } from "@/components/ui/states";
import { requirePermission } from "@/lib/auth";
import { listReservations } from "@/server/services/reservations";
import { listSelectableStations } from "@/server/services/stations";

import { ReservationsClient } from "./reservations-client";

export const metadata: Metadata = { title: "Reservations" };
export const dynamic = "force-dynamic";

export default async function ReservationsPage() {
  await requirePermission("reservations.manage");
  const [reservations, stations] = await Promise.all([listReservations("upcoming"), listSelectableStations()]);

  return (
    <Suspense fallback={<LoadingState />}>
      <ReservationsClient
        reservations={reservations.map((reservation) => ({
          id: reservation.id,
          stationId: reservation.stationId,
          stationCode: reservation.stationCode,
          stationName: reservation.stationName,
          categoryName: reservation.categoryName,
          customerName: reservation.customerName,
          mobile: reservation.mobile,
          startTime: reservation.startTime.toISOString(),
          endTime: reservation.endTime.toISOString(),
          notes: reservation.notes,
          status: reservation.status,
        }))}
        stations={stations}
      />
    </Suspense>
  );
}
