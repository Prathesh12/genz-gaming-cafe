"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/errors";
import { formDataToObject, parseOrThrow, pricingRuleSchema, uuidSchema } from "@/lib/schemas";
import { deactivatePricingRule, upsertPricingRule } from "@/server/services/admin";

export async function savePricingRuleAction(
  _prev: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("pricing.manage");
    const input = parseOrThrow(pricingRuleSchema, formDataToObject(formData));
    await upsertPricingRule(input, user);
    revalidatePath("/pricing");
    revalidatePath("/stations");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function deletePricingRuleAction(id: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("pricing.manage");
    await deactivatePricingRule(parseOrThrow(uuidSchema, id), user);
    revalidatePath("/pricing");
    revalidatePath("/stations");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Copy an entire price list from one station category to another. Cafes
 * usually have several PC categories with identical rates; this saves a lot of
 * typing without hard-coding anything.
 */
export async function copyPricingAction(fromCategoryId: string, toCategoryId: string): Promise<ActionResult<number>> {
  try {
    const user = await requirePermission("pricing.manage");
    const from = parseOrThrow(uuidSchema, fromCategoryId);
    const to = parseOrThrow(uuidSchema, toCategoryId);
    if (from === to) return actionOk(0);

    const { listPricingRules } = await import("@/server/services/pricing");
    const rules = (await listPricingRules()).filter((rule) => rule.categoryId === from && rule.isActive);

    for (const rule of rules) {
      await upsertPricingRule(
        {
          categoryId: to,
          customerType: rule.customerType,
          timeBand: rule.timeBand,
          kind: rule.kind,
          durationMinutes: rule.durationMinutes,
          playerCount: rule.playerCount,
          price: rule.price,
        },
        user,
      );
    }

    revalidatePath("/pricing");
    revalidatePath("/stations");
    return actionOk(rules.length);
  } catch (error) {
    return actionError(error);
  }
}
