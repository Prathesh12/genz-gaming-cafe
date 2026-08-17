"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/errors";
import {
  formDataToObject,
  parseOrThrow,
  stationCategorySchema,
  stationSchema,
  stationStatusSchema,
  uuidSchema,
} from "@/lib/schemas";
import {
  deleteStation,
  setStationActive,
  setStationCategoryActive,
  setStationStatus,
  upsertStation,
  upsertStationCategory,
} from "@/server/services/admin";

function refreshOperationalViews() {
  revalidatePath("/stations");
  revalidatePath("/dashboard");
  revalidatePath("/pricing");
  revalidatePath("/reservations");
}

export async function saveStationCategoryAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    const input = parseOrThrow(stationCategorySchema, formDataToObject(formData));
    await upsertStationCategory(input, user);
    refreshOperationalViews();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleStationCategoryAction(id: string, isActive: boolean): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    await setStationCategoryActive(parseOrThrow(uuidSchema, id), isActive, user);
    refreshOperationalViews();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function saveStationAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    const input = parseOrThrow(stationSchema, formDataToObject(formData));
    await upsertStation(input, user);
    refreshOperationalViews();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function setStationStatusAction(input: {
  stationId: string;
  status: "AVAILABLE" | "MAINTENANCE";
  maintenanceReason?: string | null;
}): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    const parsed = parseOrThrow(stationStatusSchema, {
      stationId: input.stationId,
      status: input.status,
      maintenanceReason: input.maintenanceReason ?? "",
    });
    await setStationStatus(parsed, user);
    refreshOperationalViews();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/** Permanently remove a station that has never been used. */
export async function deleteStationAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    await deleteStation(parseOrThrow(uuidSchema, id), user);
    refreshOperationalViews();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleStationActiveAction(id: string, isActive: boolean): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("stations.manage");
    await setStationActive(parseOrThrow(uuidSchema, id), isActive, user);
    refreshOperationalViews();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}
