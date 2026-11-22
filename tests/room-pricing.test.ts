import { describe, expect, it } from "vitest";

import {
  priceRoomSession,
  PricingError,
  roomHourlyDisplayRate,
  type EnginePricingRule,
  type PricingConfig,
  type RoomPricingSnapshot,
} from "@/server/pricing/engine";

const config: PricingConfig = {
  timezone: "Africa/Cairo",
  nightStartMinute: 0,
  nightEndMinute: 0,
  dayPassEnabled: false,
  dayPassMinutes: 720,
  minimumBillMinutes: 1,
  billingMode: "PER_MINUTE",
};

function roomRules(platform: "PS4" | "PS5"): EnginePricingRule[] {
  const amounts = platform === "PS4" ? [6000, 6000, 8000, 8000] : [8000, 8000, 10000, 10000];
  return amounts.map((price, index) => ({
    id: `${platform}-${index + 1}`,
    customerType: "REGULAR",
    timeBand: "NORMAL",
    kind: "SLAB",
    durationMinutes: 60,
    playerCount: index + 1,
    price,
  }));
}

const start = new Date("2026-11-21T12:00:00.000Z");
const after = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

describe.each([
  ["PS4", [6000, 6000, 8000, 8000]],
  ["PS5", [8000, 8000, 10000, 10000]],
] as const)("%s total-room pricing", (platform, expected) => {
  it.each([1, 2, 3, 4])("prices %i players once for one hour", (playerCount) => {
    const result = priceRoomSession({
      startedAt: start,
      endedAt: after(60),
      rules: roomRules(platform),
      config,
      playerCount,
    });

    expect(result.amount).toBe(expected[playerCount - 1]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].hourlyRate).toBe(expected[playerCount - 1]);
  });
});

describe("PlayStation room billing invariants", () => {
  it("charges a four-player PS5 room 100 EGP/hour, never 400 EGP/hour", () => {
    const result = priceRoomSession({
      startedAt: start,
      endedAt: after(60),
      rules: roomRules("PS5"),
      config,
      playerCount: 4,
    });

    expect(result.amount).toBe(10_000);
    expect(result.amount).not.toBe(40_000);
  });

  it("charges a four-player PS5 room 200 EGP for two hours", () => {
    const result = priceRoomSession({
      startedAt: start,
      endedAt: after(120),
      rules: roomRules("PS5"),
      config,
      playerCount: 4,
    });

    expect(result.amount).toBe(20_000);
  });

  it.each([0, 5, 1.5])("rejects invalid player count %s", (playerCount) => {
    expect(() =>
      priceRoomSession({
        startedAt: start,
        endedAt: after(60),
        rules: roomRules("PS4"),
        config,
        playerCount,
      }),
    ).toThrow(PricingError);
  });

  it("rejects a missing rule for the selected player count", () => {
    expect(() =>
      priceRoomSession({
        startedAt: start,
        endedAt: after(60),
        rules: roomRules("PS4").filter((rule) => rule.playerCount !== 3),
        config,
        playerCount: 3,
      }),
    ).toThrow("No room pricing is configured for 3 players.");
  });

  it("preserves pause exclusion without multiplying it by player count", () => {
    const result = priceRoomSession({
      startedAt: start,
      endedAt: after(90),
      pauses: [{ pausedAt: after(30), resumedAt: after(60) }],
      rules: roomRules("PS5"),
      config,
      playerCount: 4,
    });

    expect(result.billedMinutes).toBe(60);
    expect(result.pausedMinutes).toBe(30);
    expect(result.amount).toBe(10_000);
  });

  it("keeps an active session stable when later configuration changes", () => {
    const snapshot: RoomPricingSnapshot = {
      pricingModel: "ROOM",
      playerCount: 4,
      rules: roomRules("PS5").map((rule) => ({ ...rule })),
    };
    const changedRules = roomRules("PS5").map((rule) =>
      rule.playerCount === 4 ? { ...rule, price: 15_000 } : rule,
    );

    const agreed = priceRoomSession({
      startedAt: start,
      endedAt: after(60),
      rules: snapshot.rules,
      config,
      playerCount: snapshot.playerCount,
    });
    const changed = priceRoomSession({
      startedAt: start,
      endedAt: after(60),
      rules: changedRules,
      config,
      playerCount: 4,
    });

    expect(agreed.amount).toBe(10_000);
    expect(changed.amount).toBe(15_000);
  });

  it("returns the selected total room hourly rate", () => {
    expect(roomHourlyDisplayRate(roomRules("PS4"), config, 2, start)).toBe(6000);
    expect(roomHourlyDisplayRate(roomRules("PS4"), config, 4, start)).toBe(8000);
    expect(roomHourlyDisplayRate(roomRules("PS5"), config, 4, start)).toBe(10_000);
  });
});
