import { describe, expect, it } from "vitest";

import {
  computeDiscount,
  discountPercentOf,
  foodTotals,
  resolvePayment,
  splitBillAcrossPlayers,
} from "@/lib/billing";
import { formatMoney, formatMoneyPlain, percentOf, toMajor, toMinor } from "@/lib/money";
import { checkoutSchema, membershipSchema } from "@/lib/schemas";

describe("money", () => {
  it("converts EGP to piastres and back without drift", () => {
    expect(toMinor(120.5)).toBe(12050);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMajor(12050)).toBe(120.5);
  });

  it("formats EGP consistently with two decimal places", () => {
    expect(formatMoney(30000)).toBe("300.00 EGP");
    expect(formatMoney(30050)).toBe("300.50 EGP");
    expect(formatMoney(1234567)).toBe("12,345.67 EGP");
    expect(formatMoney(0)).toBe("0.00 EGP");
    expect(formatMoney(-5000)).toBe("-50.00 EGP");
    expect(formatMoney(15000, "EGP")).toBe("150.00 EGP");
  });

  it("formats plain amounts for CSV", () => {
    expect(formatMoneyPlain(12050)).toBe("120.50");
  });

  it("rounds percentages to the nearest piastre", () => {
    expect(percentOf(10000, 10)).toBe(1000);
    expect(percentOf(33333, 10)).toBe(3333);
  });
});

describe("discounts", () => {
  it("applies a percentage discount", () => {
    expect(computeDiscount(100000, "PERCENT", 10)).toBe(10000);
  });

  it("applies a flat discount", () => {
    expect(computeDiscount(100000, "FLAT", 15000)).toBe(15000);
  });

  it("never exceeds the subtotal", () => {
    expect(computeDiscount(50000, "FLAT", 90000)).toBe(50000);
    expect(computeDiscount(50000, "PERCENT", 150)).toBe(50000);
  });

  it("ignores zero, negative and NONE discounts", () => {
    expect(computeDiscount(50000, "NONE", 20)).toBe(0);
    expect(computeDiscount(50000, "PERCENT", 0)).toBe(0);
    expect(computeDiscount(50000, "FLAT", -100)).toBe(0);
  });

  it("reports the effective percentage so staff limits can be enforced", () => {
    expect(discountPercentOf(100000, 10000)).toBe(10);
    expect(discountPercentOf(0, 0)).toBe(0);
  });
});

describe("payments", () => {
  it("assigns the whole total to cash", () => {
    expect(resolvePayment("CASH", 67000)).toEqual({ valid: true, cashAmount: 67000, upiAmount: 0 });
  });

  it("assigns the whole total to UPI", () => {
    expect(resolvePayment("UPI", 67000)).toEqual({ valid: true, cashAmount: 0, upiAmount: 67000 });
  });

  it("accepts a split that balances exactly", () => {
    expect(resolvePayment("SPLIT", 67000, 30000, 37000)).toEqual({
      valid: true,
      cashAmount: 30000,
      upiAmount: 37000,
    });
  });

  it("rejects a split that does not add up", () => {
    const result = resolvePayment("SPLIT", 67000, 30000, 30000);
    expect(result.valid).toBe(false);
  });

  it("rejects a split with a zero side", () => {
    expect(resolvePayment("SPLIT", 67000, 67000, 0).valid).toBe(false);
    expect(resolvePayment("SPLIT", 67000, 0, 67000).valid).toBe(false);
  });

  it("rejects negative amounts", () => {
    expect(resolvePayment("SPLIT", 67000, -1000, 68000).valid).toBe(false);
    expect(resolvePayment("CASH", -1).valid).toBe(false);
  });

  it("allows a zero-value bill", () => {
    expect(resolvePayment("CASH", 0)).toEqual({ valid: true, cashAmount: 0, upiAmount: 0 });
  });
});

describe("splitting a shared bill between players", () => {
  it("gives a lone player the whole bill", () => {
    expect(splitBillAcrossPlayers([18000], 18000, 5000, 23000)).toEqual([23000]);
  });

  it("charges each player their own gaming amount plus an equal share of the food", () => {
    // 3 members at ₹150 + 1 guest at ₹180, plus ₹200 of food shared four ways.
    const shares = splitBillAcrossPlayers([15000, 15000, 15000, 18000], 63000, 20000, 83000);
    expect(shares).toEqual([20000, 20000, 20000, 23000]);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(83000);
  });

  it("always adds back up to the bill when the food does not divide evenly", () => {
    const total = 63000 + 10001;
    const shares = splitBillAcrossPlayers([15000, 15000, 15000, 18000], 63000, 10001, total);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
  });

  it("keeps each player's relative share when the counter overrides the amount", () => {
    // Calculated ₹630, charged ₹500 by hand: everyone drops in proportion.
    const shares = splitBillAcrossPlayers([15000, 15000, 15000, 18000], 50000, 0, 50000);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(50000);
    expect(shares[3]).toBeGreaterThan(shares[0]);
  });

  it("splits a manual amount evenly when nothing was calculated", () => {
    const shares = splitBillAcrossPlayers([0, 0, 0], 30000, 0, 30000);
    expect(shares).toEqual([10000, 10000, 10000]);
  });

  it("never records a negative share when a discount is larger than a player's charge", () => {
    // ₹500 off a bill where one player only played for ₹100.
    const shares = splitBillAcrossPlayers([10000, 40000], 50000, -50000, 0);
    expect(shares.every((share) => share >= 0)).toBe(true);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(0);
  });

  it("returns nothing for an empty roster", () => {
    expect(splitBillAcrossPlayers([], 0, 0, 0)).toEqual([]);
  });

  it("the shares always add up to the bill, for every mix of players and discounts", () => {
    // A deterministic sweep rather than random values, so a failure is always
    // reproducible. The invariant matters: member spend history is built from
    // these shares, so a single stray paisa would drift from the till forever.
    for (let count = 2; count <= 6; count += 1) {
      for (const perPlayer of [0, 1, 7, 15000, 18033]) {
        for (const shared of [-90000, -733, 0, 1, 12345, 250000]) {
          for (const overrideFactor of [1, 0.5, 0]) {
            const gaming = Array.from({ length: count }, (_, index) => perPlayer + index * 37);
            const calculated = gaming.reduce((sum, share) => sum + share, 0);
            const charged = Math.round(calculated * overrideFactor);
            const total = Math.max(0, charged + shared);

            const shares = splitBillAcrossPlayers(gaming, charged, shared, total);

            expect(shares).toHaveLength(count);
            expect(shares.every((share) => share >= 0 && Number.isInteger(share))).toBe(true);
            expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
          }
        }
      }
    }
  });
});

describe("food totals", () => {
  const lines = [
    { lineTotal: 15000, taxAmount: 750 },
    { lineTotal: 12000, taxAmount: 600 },
  ];

  it("sums line totals and includes tax when enabled", () => {
    expect(foodTotals(lines, true)).toEqual({ amount: 27000, taxAmount: 1350 });
  });

  it("omits tax when tax is switched off", () => {
    expect(foodTotals(lines, false)).toEqual({ amount: 27000, taxAmount: 0 });
  });

  it("handles an empty order", () => {
    expect(foodTotals([], true)).toEqual({ amount: 0, taxAmount: 0 });
  });
});

describe("membership form validation", () => {
  it("accepts the default term, which the dropdown submits as an empty value", () => {
    // Regression: the empty option coerced to 0 and failed a "minimum 1" check,
    // which surfaced as an error while the staff member was typing the price.
    const parsed = membershipSchema.safeParse({
      memberId: "6f1e7a24-0000-4000-8000-000000000000",
      startDate: "2026-08-14",
      months: "",
      price: "99",
      note: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.months).toBeUndefined();
      expect(parsed.data.price).toBe(9900); // 99.00 EGP stored as piastres
    }
  });

  it("accepts an explicit term", () => {
    const parsed = membershipSchema.safeParse({
      memberId: "6f1e7a24-0000-4000-8000-000000000000",
      startDate: "2026-08-14",
      months: "3",
      price: "99",
      note: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.months).toBe(3);
  });

  it("accepts a free membership", () => {
    const parsed = membershipSchema.safeParse({
      memberId: "6f1e7a24-0000-4000-8000-000000000000",
      startDate: "2026-08-14",
      months: "",
      price: "0",
      note: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("still rejects a nonsense duration", () => {
    const parsed = membershipSchema.safeParse({
      memberId: "6f1e7a24-0000-4000-8000-000000000000",
      startDate: "2026-08-14",
      months: "999",
      price: "99",
      note: "",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("checkout form validation", () => {
  const base = {
    sessionId: "6f1e7a24-0000-4000-8000-000000000000",
    paymentMethod: "CASH",
    cashAmount: "0",
    upiAmount: "0",
    expectedTotal: "34000",
    discountType: "NONE",
    discountValue: "0",
  };

  it("accepts a checkout with no manual amount", () => {
    const parsed = checkoutSchema.safeParse({ ...base, overrideGamingAmount: "", overrideReason: "" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.overrideGamingAmount).toBeUndefined();
  });

  it("accepts a manually agreed gaming amount", () => {
    const parsed = checkoutSchema.safeParse({
      ...base,
      overrideGamingAmount: "40",
      overrideReason: "half hour agreed",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.overrideGamingAmount).toBe(40);
  });

  it("allows a manual amount of zero (a free session)", () => {
    const parsed = checkoutSchema.safeParse({ ...base, overrideGamingAmount: "0", overrideReason: "goodwill" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.overrideGamingAmount).toBe(0);
  });

  it("rejects a negative manual amount", () => {
    const parsed = checkoutSchema.safeParse({ ...base, overrideGamingAmount: "-10", overrideReason: "" });
    expect(parsed.success).toBe(false);
  });
});
