"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { actionError, actionOk, type ActionResult } from "@/lib/errors";
import { checkoutSchema, formDataToObject, parseOrThrow, uuidSchema } from "@/lib/schemas";
import { toMinor } from "@/lib/money";
import { completeCheckout, deleteTransaction, voidTransaction } from "@/server/services/checkout";

export async function checkoutAction(
  _prev: ActionResult<{ transactionId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ transactionId: string }>> {
  try {
    const user = await requirePermission("checkout.process");
    const input = parseOrThrow(checkoutSchema, formDataToObject(formData));

    const transaction = await completeCheckout(
      {
        sessionId: input.sessionId,
        discountType: input.discountType,
        // A flat discount is typed in rupees; a percentage stays a percentage.
        discountValue: input.discountType === "FLAT" ? toMinor(input.discountValue) : input.discountValue,
        discountReason: input.discountReason,
        paymentMethod: input.paymentMethod,
        cashAmount: toMinor(input.cashAmount),
        upiAmount: toMinor(input.upiAmount),
        upiReference: input.upiReference,
        forceDayPass: input.forceDayPass,
        overrideGamingAmount:
          input.overrideGamingAmount === undefined ? null : toMinor(input.overrideGamingAmount),
        overrideReason: input.overrideReason,
        expectedTotal: input.expectedTotal,
      },
      user,
    );

    revalidatePath("/stations");
    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath("/income");
    return actionOk({ transactionId: transaction.id });
  } catch (error) {
    return actionError(error);
  }
}

/** Permanently delete a voided bill. Admin only. */
export async function deleteTransactionAction(transactionId: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("transactions.view");
    await deleteTransaction(parseOrThrow(uuidSchema, transactionId), user);
    revalidatePath("/transactions");
    revalidatePath("/income");
    revalidatePath("/dashboard");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function voidTransactionAction(transactionId: string, reason: string): Promise<ActionResult<undefined>> {
  try {
    const user = await requirePermission("income.view");
    if (!reason.trim()) {
      return { ok: false, error: "A reason is required to void a bill.", code: "VALIDATION" };
    }
    await voidTransaction(parseOrThrow(uuidSchema, transactionId), reason.trim(), user);
    revalidatePath("/transactions");
    revalidatePath("/income");
    revalidatePath("/dashboard");
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}
