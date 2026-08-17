import { describe, expect, it } from "vitest";

import {
  priceSession,
  priceSessionForPlayers,
  PricingError,
  type EnginePricingRule,
  type PricingConfig,
} from "@/server/pricing/engine";

/**
 * Charging for the time actually played.
 *
 * The cafe's complaint that started this: a session that ran a minute past the
 * hour was billed as two hours, because slab pricing rounds up to whole
 * packages. In PER_MINUTE mode the hourly price is divided by sixty and the
 * customer pays for the minutes they used.
 */

const TZ = "Asia/Kolkata";

const perMinute: PricingConfig = {
  timezone: TZ,
  nightStartMinute: 23 * 60,
  nightEndMinute: 6 * 60,
  dayPassEnabled: false,
  dayPassMinutes: 720,
  minimumBillMinutes: 1,
  billingMode: "PER_MINUTE",
};

const slab: PricingConfig = { ...perMinute, billingMode: "SLAB" };

/** Regular ₹100/hr (also a 2h deal), member ₹80/hr, night ₹150/hr. */
function rules(): EnginePricingRule[] {
  const mk = (
    customerType: "REGULAR" | "MEMBER",
    timeBand: "NORMAL" | "NIGHT",
    durationMinutes: number,
    rupees: number,
    kind: "SLAB" | "DAY_PASS" = "SLAB",
  ): EnginePricingRule => ({
    id: `${customerType}-${timeBand}-${kind}-${durationMinutes}`,
    customerType,
    timeBand,
    kind,
    durationMinutes,
    price: rupees * 100,
  });

  return [
    mk("REGULAR", "NORMAL", 60, 100),
    mk("REGULAR", "NORMAL", 120, 180),
    mk("MEMBER", "NORMAL", 60, 80),
    mk("REGULAR", "NIGHT", 60, 150),
    mk("MEMBER", "NIGHT", 60, 120),
  ];
}

function ist(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 7, day, hour - 5, minute - 30));
}

function price(startedAt: Date, endedAt: Date, config = perMinute, customerType: "REGULAR" | "MEMBER" = "REGULAR") {
  return priceSession({ startedAt, endedAt, rules: rules(), config, customerType });
}

describe("charging by the minute", () => {
  it("charges an exact hour at exactly the hourly price", () => {
    expect(price(ist(14, 15), ist(14, 16)).amount).toBe(10_000);
  });

  it("charges an hour and a quarter as ₹125, not two hours", () => {
    expect(price(ist(14, 15), ist(14, 16, 15)).amount).toBe(12_500);
  });

  it("does not jump to a second hour one minute past the first", () => {
    // The reported bug: this used to be billed as 2 hours.
    const oneMinuteOver = price(ist(14, 15), ist(14, 16, 1)).amount;
    expect(oneMinuteOver).toBe(10_200); // ₹101.67, rounded to the rupee
    expect(oneMinuteOver).toBeLessThan(2 * 10_000);

    // Slab mode is what it always was, for a cafe that sells packages.
    expect(price(ist(14, 15), ist(14, 16, 1), slab).amount).toBe(18_000);
  });

  it("charges half an hour as half the hourly price", () => {
    expect(price(ist(14, 15), ist(14, 15, 30)).amount).toBe(5_000);
  });

  it("lands every line on a whole rupee", () => {
    for (const minutes of [1, 7, 13, 29, 41, 59, 61, 97, 143]) {
      const amount = price(ist(14, 15), new Date(ist(14, 15).getTime() + minutes * 60_000)).amount;
      expect(amount % 100, `${minutes} minutes`).toBe(0);
    }
  });

  it("uses the member hourly price for members", () => {
    // 90 minutes at ₹80/hr.
    expect(price(ist(14, 15), ist(14, 16, 30), perMinute, "MEMBER").amount).toBe(12_000);
  });

  it("prices each side of the night boundary at its own hourly price", () => {
    // 22:30 -> 00:30: 30 min normal at ₹100/hr, 90 min night at ₹150/hr.
    const result = price(ist(14, 22, 30), ist(15, 0, 30));
    expect(result.amount).toBe(5_000 + 22_500);
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((segment) => segment.hourlyRate)).toBe(true);
  });

  it("switches to regular rates when a membership expires mid-session", () => {
    const result = priceSession({
      startedAt: ist(14, 12),
      endedAt: ist(14, 14),
      rules: rules(),
      config: perMinute,
      customerType: "MEMBER",
      membershipValidUntil: ist(14, 13),
    });
    // One hour as a member (₹80) plus one hour at the regular rate (₹100).
    expect(result.amount).toBe(18_000);
  });

  it("never charges for paused time", () => {
    const result = priceSession({
      startedAt: ist(14, 10),
      endedAt: ist(14, 13),
      pauses: [{ pausedAt: ist(14, 11), resumedAt: ist(14, 12) }],
      rules: rules(),
      config: perMinute,
      customerType: "REGULAR",
    });
    expect(result.billedMinutes).toBe(120);
    expect(result.amount).toBe(20_000);
  });

  it("still honours the minimum billable time", () => {
    const result = price(ist(14, 15), ist(14, 15, 3), { ...perMinute, minimumBillMinutes: 5 });
    expect(result.amount).toBe(0);
  });

  it("still applies a day pass when it is cheaper", () => {
    const withPass: EnginePricingRule[] = [
      ...rules(),
      {
        id: "pass",
        customerType: "REGULAR",
        timeBand: "NORMAL",
        kind: "DAY_PASS",
        durationMinutes: 720,
        price: 50_000,
      },
    ];
    const result = priceSession({
      startedAt: ist(14, 10),
      endedAt: ist(14, 18), // eight hours = ₹800 by the minute
      rules: withPass,
      config: { ...perMinute, dayPassEnabled: true },
      customerType: "REGULAR",
    });
    expect(result.dayPassApplied).toBe(true);
    expect(result.amount).toBe(50_000);
  });

  it("says on the bill how the time was charged", () => {
    const result = price(ist(14, 15), ist(14, 16, 15));
    expect(result.notes).toContain("Charged for the time actually played, at the hourly rate.");
    expect(result.segments[0].hourlyRate).toBe(10_000);
  });

  it("falls back to regular rates when member rates are missing, rather than failing", () => {
    const regularOnly = rules().filter((rule) => rule.customerType === "REGULAR");
    const result = priceSession({
      startedAt: ist(14, 15),
      endedAt: ist(14, 16),
      rules: regularOnly,
      config: perMinute,
      customerType: "MEMBER",
    });
    expect(result.amount).toBe(10_000);
    expect(result.notes.join(" ")).toContain("No member rates configured");
  });

  it("still refuses to invent a price when nothing is configured", () => {
    expect(() =>
      priceSession({
        startedAt: ist(14, 15),
        endedAt: ist(14, 16),
        rules: [],
        config: perMinute,
        customerType: "REGULAR",
      }),
    ).toThrow(PricingError);
  });

  it("charges each player on a shared station by the minute", () => {
    const result = priceSessionForPlayers({
      startedAt: ist(14, 15),
      endedAt: ist(14, 16, 30), // 90 minutes
      rules: rules(),
      config: perMinute,
      players: [
        { slot: 1, label: "A", customerType: "MEMBER" },
        { slot: 2, label: "B", customerType: "REGULAR" },
      ],
    });
    // Member 90 min at ₹80/hr = ₹120; guest 90 min at ₹100/hr = ₹150.
    expect(result.players.map((player) => player.amount)).toEqual([12_000, 15_000]);
    expect(result.amount).toBe(27_000);
  });

  it("defaults to charging by the minute when no mode is set", () => {
    const withoutMode: PricingConfig = { ...perMinute };
    delete withoutMode.billingMode;
    const result = priceSession({
      startedAt: ist(14, 15),
      endedAt: ist(14, 16, 15),
      rules: rules(),
      config: withoutMode,
      customerType: "REGULAR",
    });
    expect(result.amount).toBe(12_500);
  });
});
