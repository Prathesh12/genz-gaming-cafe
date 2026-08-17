import { describe, expect, it } from "vitest";

import {
  priceSession,
  priceSessionForPlayers,
  type EnginePlayer,
  type EnginePricingRule,
  type PricingConfig,
} from "@/server/pricing/engine";

/**
 * Several people sharing one station.
 *
 * The rule the cafe chose: everybody plays the same minutes, and each player is
 * charged their own rate for those minutes. A member pays member rates, a guest
 * pays regular rates, and the bill is the sum.
 */

const TZ = "Asia/Kolkata";

const config: PricingConfig = {
  timezone: TZ,
  nightStartMinute: 23 * 60,
  nightEndMinute: 6 * 60,
  dayPassEnabled: false,
  dayPassMinutes: 720,
  minimumBillMinutes: 1,
  // Slab mode, so the per-player maths is checked against fixed packages.
  billingMode: "SLAB",
};

/** PS5 multiplayer prices: regular ₹180/hr, member ₹150/hr. */
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
    mk("REGULAR", "NORMAL", 30, 100),
    mk("REGULAR", "NORMAL", 60, 180),
    mk("MEMBER", "NORMAL", 30, 80),
    mk("MEMBER", "NORMAL", 60, 150),
    mk("REGULAR", "NIGHT", 60, 240),
    mk("MEMBER", "NIGHT", 60, 200),
  ];
}

function ist(day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 7, day, hour - 5, minute - 30));
}

function player(slot: number, customerType: "REGULAR" | "MEMBER", validUntil: Date | null = null): EnginePlayer {
  return { slot, label: `Player ${slot}`, customerType, membershipValidUntil: validUntil };
}

describe("pricing a station shared by several players", () => {
  const startedAt = ist(14, 15);
  const endedAt = ist(14, 16); // exactly one hour

  it("charges three members and one guest their own rates", () => {
    const result = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "MEMBER"), player(2, "MEMBER"), player(3, "MEMBER"), player(4, "REGULAR")],
    });

    // 3 x ₹150 + 1 x ₹180 = ₹630
    expect(result.amount).toBe(63000);
    expect(result.playerCount).toBe(4);
    expect(result.players.map((p) => p.amount)).toEqual([15000, 15000, 15000, 18000]);
    expect(result.billedMinutes).toBe(60);
  });

  it("adds up to the same as pricing each player separately", () => {
    const roster = [player(1, "MEMBER"), player(2, "REGULAR"), player(3, "REGULAR")];
    const together = priceSessionForPlayers({ startedAt, endedAt, rules: rules(), config, players: roster });

    const separately = roster.reduce(
      (sum, entry) =>
        sum +
        priceSession({
          startedAt,
          endedAt,
          rules: rules(),
          config,
          customerType: entry.customerType,
          membershipValidUntil: entry.membershipValidUntil,
        }).amount,
      0,
    );

    expect(together.amount).toBe(separately);
  });

  it("behaves exactly like a normal session when one person plays", () => {
    const solo = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "MEMBER")],
    });
    const original = priceSession({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      customerType: "MEMBER",
    });

    expect(solo.amount).toBe(original.amount);
    expect(solo.segments).toEqual(original.segments);
    expect(solo.notes).toEqual(original.notes);
    expect(solo.playerCount).toBe(1);
  });

  it("falls back to one regular player when the roster is empty", () => {
    const result = priceSessionForPlayers({ startedAt, endedAt, rules: rules(), config, players: [] });
    expect(result.amount).toBe(18000);
    expect(result.playerCount).toBe(1);
  });

  it("groups the receipt lines by rate and counts the players on each", () => {
    const result = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "MEMBER"), player(2, "MEMBER"), player(3, "REGULAR")],
    });

    const member = result.segments.find((segment) => segment.customerType === "MEMBER");
    const regular = result.segments.find((segment) => segment.customerType === "REGULAR");

    expect(member).toMatchObject({ players: 2, minutes: 60, amount: 30000 });
    expect(regular).toMatchObject({ players: 1, minutes: 60, amount: 18000 });
  });

  it("splits every player at the night boundary", () => {
    // 22:30 -> 00:30, so 30 min normal and 90 min night for everyone.
    const result = priceSessionForPlayers({
      startedAt: ist(14, 22, 30),
      endedAt: ist(15, 0, 30),
      rules: rules(),
      config,
      players: [player(1, "MEMBER"), player(2, "REGULAR")],
    });

    const solo = (customerType: "REGULAR" | "MEMBER") =>
      priceSession({
        startedAt: ist(14, 22, 30),
        endedAt: ist(15, 0, 30),
        rules: rules(),
        config,
        customerType,
      }).amount;

    expect(result.amount).toBe(solo("MEMBER") + solo("REGULAR"));
    expect(result.billedMinutes).toBe(120);
  });

  it("charges only the player whose membership expires mid-session at regular rates afterwards", () => {
    const expiring = player(2, "MEMBER", ist(14, 15, 30)); // lapses half an hour in
    const result = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "MEMBER"), expiring],
    });

    // Player 1: a full hour at member rate. Player 2: 30 min member + 30 min
    // regular, each priced with its own 30-minute slab.
    expect(result.players[0].amount).toBe(15000);
    expect(result.players[1].amount).toBe(8000 + 10000);
    expect(result.amount).toBe(15000 + 18000);
  });

  it("names the player a partial note belongs to", () => {
    const result = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "MEMBER"), player(2, "MEMBER", ist(14, 15, 30))],
    });

    const expiryNote = result.notes.find((note) => note.includes("Membership expired"));
    expect(expiryNote).toBeDefined();
    expect(expiryNote).toContain("Player 2");
    expect(expiryNote).not.toContain("Player 1");
  });

  it("summarises the mix of players at the top of the notes", () => {
    const mixed = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "MEMBER"), player(2, "MEMBER"), player(3, "MEMBER"), player(4, "REGULAR")],
    });
    expect(mixed.notes[0]).toBe("4 players — 3 at member rates, 1 at regular rates.");

    const allGuests = priceSessionForPlayers({
      startedAt,
      endedAt,
      rules: rules(),
      config,
      players: [player(1, "REGULAR"), player(2, "REGULAR")],
    });
    expect(allGuests.notes[0]).toBe("2 players, each charged at the regular rate.");
  });

  it("excludes paused time once, not once per player", () => {
    const result = priceSessionForPlayers({
      startedAt,
      endedAt,
      pauses: [{ pausedAt: ist(14, 15, 20), resumedAt: ist(14, 15, 50) }],
      rules: rules(),
      config,
      players: [player(1, "REGULAR"), player(2, "REGULAR")],
    });

    // 30 minutes played by each of two guests: 2 x ₹100.
    expect(result.billedMinutes).toBe(30);
    expect(result.pausedMinutes).toBe(30);
    expect(result.amount).toBe(20000);
  });

  it("gives every player their own day pass when it is cheaper", () => {
    const dayPassRules = [
      ...rules(),
      {
        id: "day-pass",
        customerType: "REGULAR" as const,
        timeBand: "NORMAL" as const,
        kind: "DAY_PASS" as const,
        durationMinutes: 720,
        price: 50000,
      },
    ];
    const result = priceSessionForPlayers({
      startedAt: ist(14, 10),
      endedAt: ist(14, 16), // six hours
      rules: dayPassRules,
      config: { ...config, dayPassEnabled: true },
      players: [player(1, "REGULAR"), player(2, "REGULAR")],
    });

    expect(result.dayPassApplied).toBe(true);
    expect(result.amount).toBe(100000); // ₹500 each
  });
});
