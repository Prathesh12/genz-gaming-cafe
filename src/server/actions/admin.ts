"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/errors";
import {
  formDataToObject,
  parseOrThrow,
  reservationSchema,
  settingsSchema,
  staffCreateSchema,
  staffUpdateSchema,
  uuidSchema,
} from "@/lib/schemas";
import { createStaff, updateSettings, updateStaff } from "@/server/services/admin";
import { clearLogo, setLogo } from "@/server/services/settings";
import { cancelReservation, markNoShow, upsertReservation } from "@/server/services/reservations";

/* ----------------------------- Reservations ----------------------------- */

export async function saveReservationAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("reservations.manage");
    const input = parseOrThrow(reservationSchema, formDataToObject(formData));
    await upsertReservation(
      {
        id: input.id,
        stationId: input.stationId,
        customerName: input.customerName,
        mobile: input.mobile,
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        notes: input.notes,
      },
      user,
    );
    revalidatePath("/reservations");
    revalidatePath("/stations");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function cancelReservationAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("reservations.manage");
    await cancelReservation(parseOrThrow(uuidSchema, id), user);
    revalidatePath("/reservations");
    revalidatePath("/stations");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function markNoShowAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("reservations.manage");
    await markNoShow(parseOrThrow(uuidSchema, id), user);
    revalidatePath("/reservations");
    revalidatePath("/stations");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/* -------------------------------- Staff --------------------------------- */

export async function createStaffAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("staff.manage");
    await createStaff(parseOrThrow(staffCreateSchema, formDataToObject(formData)), user);
    revalidatePath("/staff");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function updateStaffAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("staff.manage");
    const input = parseOrThrow(staffUpdateSchema, formDataToObject(formData));
    await updateStaff({ ...input, password: input.password || undefined }, user);
    revalidatePath("/staff");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/* ------------------------------- Settings ------------------------------- */

export async function updateSettingsAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("settings.manage");
    const input = parseOrThrow(settingsSchema, formDataToObject(formData));
    await updateSettings(input, user);
    revalidatePath("/settings");
    revalidatePath("/stations");
    revalidatePath("/dashboard");
    revalidatePath("/income");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Save a new cafe logo. The browser sends it as a `data:` URL it has already
 * re-drawn to PNG at a sensible size; the service checks it again regardless.
 */
export async function saveLogoAction(dataUrl: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("settings.manage");
    await setLogo(dataUrl, user);
    revalidateLogo();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function removeLogoAction(): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("settings.manage");
    await clearLogo(user);
    revalidateLogo();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/** The logo appears in the sidebar, on the sign-in screen and on receipts. */
function revalidateLogo() {
  revalidatePath("/settings");
  revalidatePath("/login");
  revalidatePath("/", "layout");
}
