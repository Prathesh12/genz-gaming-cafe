"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/errors";
import {
  foodCategorySchema,
  foodItemSchema,
  foodOrderSchema,
  formDataToObject,
  parseOrThrow,
  uuidSchema,
} from "@/lib/schemas";
import {
  setFoodCategoryActive,
  setFoodItemActive,
  setFoodItemAvailability,
  upsertFoodCategory,
  upsertFoodItem,
} from "@/server/services/admin";
import { cancelFoodOrder, createFoodOrder, setFoodOrderStatus } from "@/server/services/food";

function refreshMenu() {
  revalidatePath("/food");
  revalidatePath("/stations");
}

export async function saveFoodCategoryAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("food.manage");
    await upsertFoodCategory(parseOrThrow(foodCategorySchema, formDataToObject(formData)), user);
    refreshMenu();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleFoodCategoryAction(id: string, isActive: boolean): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("food.manage");
    await setFoodCategoryActive(parseOrThrow(uuidSchema, id), isActive, user);
    refreshMenu();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function saveFoodItemAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("food.manage");
    await upsertFoodItem(parseOrThrow(foodItemSchema, formDataToObject(formData)), user);
    refreshMenu();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleFoodItemActiveAction(id: string, isActive: boolean): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("food.manage");
    await setFoodItemActive(parseOrThrow(uuidSchema, id), isActive, user);
    refreshMenu();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function toggleFoodItemAvailabilityAction(
  id: string,
  isAvailable: boolean,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("food.manage");
    await setFoodItemAvailability(parseOrThrow(uuidSchema, id), isAvailable, user);
    refreshMenu();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function addFoodOrderAction(input: {
  sessionId: string;
  notes?: string;
  items: { foodItemId: string; quantity: number }[];
}): Promise<ActionResult<{ total: number }>> {
  try {
    const user = await requirePermission("sessions.operate");
    const parsed = parseOrThrow(foodOrderSchema, {
      sessionId: input.sessionId,
      notes: input.notes ?? "",
      items: input.items,
    });
    const { total } = await createFoodOrder(parsed, user);
    revalidatePath("/stations");
    revalidatePath("/dashboard");
    return actionOk({ total });
  } catch (error) {
    return actionError(error);
  }
}

export async function setFoodOrderStatusAction(
  orderId: string,
  status: "ORDERED" | "PREPARING" | "READY" | "SERVED",
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("sessions.operate");
    await setFoodOrderStatus(parseOrThrow(uuidSchema, orderId), status, user);
    revalidatePath("/stations");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function cancelFoodOrderAction(orderId: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("sessions.operate");
    await cancelFoodOrder(parseOrThrow(uuidSchema, orderId), user);
    revalidatePath("/stations");
    revalidatePath("/dashboard");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}
