/**
 * Pure billing helpers shared by the checkout service and the checkout UI, so
 * both sides of the counter agree on the arithmetic. No database, no imports —
 * fully unit-testable.
 */
import { percentOf } from "@/lib/money";

export type DiscountType = "NONE" | "FLAT" | "PERCENT";
export type PaymentMethod = "CASH" | "UPI" | "SPLIT";

/** Discount in minor units, never more than the subtotal. */
export function computeDiscount(subtotal: number, type: DiscountType, value: number): number {
  if (type === "NONE" || value <= 0 || subtotal <= 0) return 0;
  if (type === "PERCENT") return Math.min(subtotal, percentOf(subtotal, Math.min(100, value)));
  return Math.min(subtotal, Math.round(value));
}

export type SplitCheck =
  | { valid: true; cashAmount: number; upiAmount: number }
  | { valid: false; reason: string };

/**
 * Resolve and validate the amounts for a payment. Cash and UPI must add up to
 * the total exactly — a split that does not balance is never accepted.
 */
export function resolvePayment(
  method: PaymentMethod,
  total: number,
  cashInput = 0,
  upiInput = 0,
): SplitCheck {
  if (total < 0) return { valid: false, reason: "The total cannot be negative." };

  if (method === "CASH") return { valid: true, cashAmount: total, upiAmount: 0 };
  if (method === "UPI") return { valid: true, cashAmount: 0, upiAmount: total };

  const cashAmount = Math.round(cashInput);
  const upiAmount = Math.round(upiInput);

  if (cashAmount < 0 || upiAmount < 0) return { valid: false, reason: "Split amounts cannot be negative." };
  if (cashAmount === 0 || upiAmount === 0) {
    return { valid: false, reason: "A split payment needs a cash part and a UPI part." };
  }
  if (cashAmount + upiAmount !== total) {
    return { valid: false, reason: "Cash + UPI must equal the total." };
  }
  return { valid: true, cashAmount, upiAmount };
}

/** Effective percentage a discount represents, used to enforce staff limits. */
export function discountPercentOf(subtotal: number, discountAmount: number): number {
  if (subtotal <= 0) return 0;
  return (discountAmount * 100) / subtotal;
}

/**
 * What each player on a shared station actually paid.
 *
 * Their own gaming charge, plus an equal share of everything the table shared —
 * food, tax and any discount. Rounding leftovers are handed out one paisa at a
 * time from the first seat, so the shares always add up to the bill exactly and
 * a member's spend history can never drift from the till.
 *
 * With one player this simply returns the whole total, which is why existing
 * member spend figures are unchanged.
 */
export function splitBillAcrossPlayers(
  gamingShares: number[],
  chargedGaming: number,
  sharedAmount: number,
  totalAmount: number,
): number[] {
  const count = gamingShares.length;
  if (count === 0) return [];
  if (count === 1) return [totalAmount];

  // A manual amount at checkout replaces the calculated gaming charge; keep
  // each player's relative share of it rather than flattening everyone.
  const calculated = gamingShares.reduce((sum, share) => sum + share, 0);
  const gaming =
    chargedGaming === calculated
      ? [...gamingShares]
      : calculated > 0
        ? gamingShares.map((share) => (share * chargedGaming) / calculated)
        : gamingShares.map(() => chargedGaming / count);

  // What each player would owe before rounding. A discount can be bigger than a
  // quiet player's own charge, so this is floored at zero — nobody is ever
  // recorded as having paid a negative amount.
  const ideal = gaming.map((share) => Math.max(0, share + sharedAmount / count));
  const idealTotal = ideal.reduce((sum, share) => sum + share, 0);

  // Scale onto the actual total, so the parts describe the bill that was taken
  // rather than the bill before rounding and clamping.
  const shares =
    idealTotal > 0
      ? ideal.map((share) => Math.floor((share * totalAmount) / idealTotal))
      : ideal.map(() => Math.floor(totalAmount / count));

  // At most one paisa each is left over; hand it out from the first seat.
  let remainder = totalAmount - shares.reduce((sum, share) => sum + share, 0);
  for (let index = 0; remainder > 0 && index < count; index += 1) {
    shares[index] += 1;
    remainder -= 1;
  }
  for (let index = 0; remainder < 0 && index < count; index += 1) {
    if (shares[index] === 0) continue;
    shares[index] -= 1;
    remainder += 1;
  }

  return shares;
}

/** Sum of food lines plus tax where tax is enabled. */
export function foodTotals(
  lines: { lineTotal: number; taxAmount: number }[],
  taxEnabled: boolean,
): { amount: number; taxAmount: number } {
  return {
    amount: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    taxAmount: taxEnabled ? lines.reduce((sum, line) => sum + line.taxAmount, 0) : 0,
  };
}
