import { describe, expect, it } from "vitest";

import {
  bandAt,
  hourlyDisplayRate,
  isNightMinute,
  minimumSlabCost,
  priceSession,
  PricingError,
  subtractPauses,
  type EnginePricingRule,
  type PricingConfig,
} from "@/server/pricing/engine";

const TZ = "Asia/Kolkata";

const config: PricingConfig = {
  timezone: TZ,
  nightStartMinute: 23 * 60, // 23:00
  nightEndMinute: 6 * 60, // 06:00
  dayPassEnabled: true,
  dayPassMinutes: 720,
  minimumBillMinutes: 1,
  // These tests document SLAB pricing specifically, so the mode is explicit
  // rather than relying on the default.
  billingMode: "SLAB",
};

/** Prices in paise. Regular: 30m ₹60, 1h ₹100, 2h ₹180, 3h ₹250. */
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
    mk("REGULAR", "NORMAL", 30, 60),
    mk("REGULAR", "NORMAL", 60, 100),
    mk("REGULAR", "NORMAL", 120, 180),
    mk("REGULAR", "NORMAL", 180, 250),
    mk("MEMBER", "NORMAL", 30, 50),
    mk("MEMBER", "NORMAL", 60, 80),
    mk("MEMBER", "NORMAL", 120, 150),
    mk("REGULAR", "NIGHT", 60, 150),
    mk("REGULAR", "NIGHT", 120, 260),
    mk("MEMBER", "NIGHT", 60, 120),
    mk("REGULAR", "NORMAL", 720, 700, "DAY_PASS"),
  ];
}

/** Build a UTC instant from an IST wall-clock time. IST is UTC+5:30. */
function ist(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 7, day, hour - 5, minute - 30));
}

describe("night band detection", () => {
  it("handles a band that wraps midnight", () => {
    expect(isNightMinute(23 * 60 + 30, 23 * 60, 6 * 60)).toBe(true);
    expect(isNightMinute(2 * 60, 23 * 60, 6 * 60)).toBe(true);
    expect(isNightMinute(6 * 60, 23 * 60, 6 * 60)).toBe(false);
    expect(isNightMinute(22 * 60 + 59, 23 * 60, 6 * 60)).toBe(false);
  });

  it("handles a band inside a single day", () => {
    expect(isNightMinute(13 * 60, 12 * 60, 15 * 60)).toBe(true);
    expect(isNightMinute(16 * 60, 12 * 60, 15 * 60)).toBe(false);
  });

  it("resolves the band of an instant in the cafe timezone", () => {
    expect(bandAt(ist(14, 20, 0), config)).toBe("NORMAL");
    expect(bandAt(ist(14, 23, 30), config)).toBe("NIGHT");
    expect(bandAt(ist(15, 1, 0), config)).toBe("NIGHT");
    expect(bandAt(ist(15, 7, 0), config)).toBe("NORMAL");
  });
});

describe("minimumSlabCost", () => {
  const slabs = [
    { durationMinutes: 30, price: 6000 },
    { durationMinutes: 60, price: 10000 },
    { durationMinutes: 120, price: 18000 },
  ];

  it("rounds a short session up to the smallest slab", () => {
    expect(minimumSlabCost(slabs, 1).amount).toBe(6000);
    expect(minimumSlabCost(slabs, 30).amount).toBe(6000);
  });

  it("never charges more than the next slab up", () => {
    // 50 minutes: the 1 hour slab (₹100) beats two 30 min slabs (₹120).
    expect(minimumSlabCost(slabs, 50).amount).toBe(10000);
  });

  it("combines slabs beyond the largest configured duration", () => {
    // 3 hours = 2h slab (₹180) + 1h slab (₹100) = ₹280.
    expect(minimumSlabCost(slabs, 180).amount).toBe(28000);
    // 2h10m = 2h (₹180) + 30m (₹60) = ₹240, cheaper than 3 x 1h (₹300).
    expect(minimumSlabCost(slabs, 130).amount).toBe(24000);
  });

  it("reports the slab composition", () => {
    const result = minimumSlabCost(slabs, 130);
    expect(result.slabs).toEqual([
      { durationMinutes: 30, price: 6000, count: 1 },
      { durationMinutes: 120, price: 18000, count: 1 },
    ]);
  });

  it("throws when nothing is configured", () => {
    expect(() => minimumSlabCost([], 60)).toThrow(PricingError);
  });

  it("returns zero for a zero-length session", () => {
    expect(minimumSlabCost(slabs, 0).amount).toBe(0);
  });
});

describe("subtractPauses", () => {
  it("removes a closed pause window", () => {
    const result = subtractPauses(ist(14, 10), ist(14, 13), [
      { pausedAt: ist(14, 11), resumedAt: ist(14, 12) },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].end.getTime()).toBe(ist(14, 11).getTime());
    expect(result[1].start.getTime()).toBe(ist(14, 12).getTime());
  });

  it("treats an open pause as lasting until the end", () => {
    const result = subtractPauses(ist(14, 10), ist(14, 13), [
      { pausedAt: ist(14, 11), resumedAt: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].end.getTime()).toBe(ist(14, 11).getTime());
  });

  it("merges overlapping pauses", () => {
    const result = subtractPauses(ist(14, 10), ist(14, 14), [
      { pausedAt: ist(14, 11), resumedAt: ist(14, 12, 30) },
      { pausedAt: ist(14, 12), resumedAt: ist(14, 13) },
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].start.getTime()).toBe(ist(14, 13).getTime());
  });
});

describe("priceSession", () => {
  it("prices a simple 2 hour regular session", () => {
    const result = priceSession({
      startedAt: ist(14, 14),
      endedAt: ist(14, 16),
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    expect(result.amount).toBe(18000); // ₹180
    expect(result.billedMinutes).toBe(120);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].timeBand).toBe("NORMAL");
  });

  it("applies member pricing", () => {
    const result = priceSession({
      startedAt: ist(14, 14),
      endedAt: ist(14, 16),
      rules: rules(),
      config,
      customerType: "MEMBER",
      membershipValidUntil: ist(20, 0),
    });
    expect(result.amount).toBe(15000); // ₹150
  });

  it("splits a session that crosses into the night band", () => {
    // 22:30 -> 00:30 = 30 min normal + 90 min night.
    const result = priceSession({
      startedAt: ist(14, 22, 30),
      endedAt: ist(15, 0, 30),
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    const normal = result.segments.find((s) => s.timeBand === "NORMAL");
    const night = result.segments.find((s) => s.timeBand === "NIGHT");
    expect(normal?.minutes).toBe(30);
    expect(night?.minutes).toBe(90);
    // Normal 30 min = ₹60. Night 90 min: 1h (₹150) + 1h (₹150) = ₹300 vs 2h ₹260 -> ₹260.
    expect(normal?.amount).toBe(6000);
    expect(night?.amount).toBe(26000);
    expect(result.amount).toBe(32000);
  });

  it("splits a session that crosses out of the night band", () => {
    // 05:00 -> 07:00 = 60 min night + 60 min normal.
    const result = priceSession({
      startedAt: ist(15, 5),
      endedAt: ist(15, 7),
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    expect(result.segments.find((s) => s.timeBand === "NIGHT")?.minutes).toBe(60);
    expect(result.segments.find((s) => s.timeBand === "NORMAL")?.minutes).toBe(60);
    expect(result.amount).toBe(15000 + 10000);
  });

  it("handles a session crossing midnight entirely inside the night band", () => {
    const result = priceSession({
      startedAt: ist(14, 23, 30),
      endedAt: ist(15, 1, 30),
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].timeBand).toBe("NIGHT");
    expect(result.billedMinutes).toBe(120);
    expect(result.amount).toBe(26000);
  });

  it("excludes paused time from the bill", () => {
    const result = priceSession({
      startedAt: ist(14, 10),
      endedAt: ist(14, 13),
      pauses: [{ pausedAt: ist(14, 11), resumedAt: ist(14, 12) }],
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    expect(result.wallMinutes).toBe(180);
    expect(result.billedMinutes).toBe(120);
    expect(result.pausedMinutes).toBe(60);
    expect(result.amount).toBe(18000);
  });

  it("switches to regular rates when a membership expires mid-session", () => {
    const result = priceSession({
      startedAt: ist(14, 12),
      endedAt: ist(14, 14),
      rules: rules(),
      config,
      customerType: "MEMBER",
      membershipValidUntil: ist(14, 13),
    });
    const member = result.segments.find((s) => s.customerType === "MEMBER");
    const regular = result.segments.find((s) => s.customerType === "REGULAR");
    expect(member?.minutes).toBe(60);
    expect(regular?.minutes).toBe(60);
    expect(result.amount).toBe(8000 + 10000); // ₹80 member hour + ₹100 regular hour
    expect(result.notes.join(" ")).toContain("Membership expired");
  });

  it("applies a day pass when it is cheaper than slabs", () => {
    // 10 hours normal: slabs would cost far more than the ₹700 day pass.
    const result = priceSession({
      startedAt: ist(14, 10),
      endedAt: ist(14, 20),
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    expect(result.dayPassApplied).toBe(true);
    expect(result.amount).toBe(70000);
  });

  it("does not apply a day pass for a short session", () => {
    const result = priceSession({
      startedAt: ist(14, 10),
      endedAt: ist(14, 11),
      rules: rules(),
      config,
      customerType: "REGULAR",
    });
    expect(result.dayPassApplied).toBe(false);
    expect(result.amount).toBe(10000);
  });

  it("does not charge a session below the minimum billable duration", () => {
    const result = priceSession({
      startedAt: ist(14, 10),
      endedAt: ist(14, 10, 0),
      rules: rules(),
      config: { ...config, minimumBillMinutes: 5 },
      customerType: "REGULAR",
    });
    expect(result.amount).toBe(0);
  });

  it("falls back to regular rates when member rates are missing for a band", () => {
    const withoutMemberNight = rules().filter(
      (r) => !(r.customerType === "MEMBER" && r.timeBand === "NIGHT"),
    );
    const result = priceSession({
      startedAt: ist(14, 23, 30),
      endedAt: ist(15, 0, 30),
      rules: withoutMemberNight,
      config,
      customerType: "MEMBER",
      membershipValidUntil: ist(20, 0),
    });
    expect(result.notes.join(" ")).toContain("regular rates used");
    expect(result.amount).toBeGreaterThan(0);
  });

  it("rejects an end time before the start time", () => {
    expect(() =>
      priceSession({
        startedAt: ist(14, 12),
        endedAt: ist(14, 11),
        rules: rules(),
        config,
        customerType: "REGULAR",
      }),
    ).toThrow(PricingError);
  });

  it("rounds partial minutes up", () => {
    const start = ist(14, 10);
    const end = new Date(start.getTime() + 61 * 60 * 1000 + 1000); // 1h 1m 1s
    const result = priceSession({ startedAt: start, endedAt: end, rules: rules(), config, customerType: "REGULAR" });
    expect(result.billedMinutes).toBe(62);
    // 62 min -> 1h + 30m (₹160) is cheaper than 2h (₹180).
    expect(result.amount).toBe(16000);
  });

  it("exposes an hourly display rate for station cards", () => {
    expect(hourlyDisplayRate(rules(), config, "REGULAR", ist(14, 15))).toBe(10000);
    expect(hourlyDisplayRate(rules(), config, "REGULAR", ist(15, 1))).toBe(15000);
    expect(hourlyDisplayRate(rules(), config, "MEMBER", ist(14, 15))).toBe(8000);
    expect(hourlyDisplayRate([], config, "REGULAR")).toBeNull();
  });
});
