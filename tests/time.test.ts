import { describe, expect, it } from "vitest";

import {
  addDaysInZone,
  endOfDayInZone,
  formatDurationHMS,
  formatDurationHuman,
  formatHHmm,
  fromDateKey,
  minutesOfDay,
  parseHHmm,
  startOfDayInZone,
  toDateKey,
} from "@/lib/time";

const TZ = "Asia/Kolkata";

describe("timezone helpers", () => {
  it("finds local midnight for an instant late in the UTC day", () => {
    // 2026-08-14 21:00 UTC is 2026-08-15 02:30 IST, so local midnight is the 15th.
    const instant = new Date("2026-08-14T21:00:00.000Z");
    expect(toDateKey(instant, TZ)).toBe("2026-08-15");
    expect(startOfDayInZone(instant, TZ).toISOString()).toBe("2026-08-14T18:30:00.000Z");
    expect(endOfDayInZone(instant, TZ).toISOString()).toBe("2026-08-15T18:30:00.000Z");
  });

  it("round-trips a date key", () => {
    const parsed = fromDateKey("2026-08-14", TZ);
    expect(parsed.toISOString()).toBe("2026-08-13T18:30:00.000Z");
    expect(toDateKey(parsed, TZ)).toBe("2026-08-14");
  });

  it("adds local days across a month boundary", () => {
    const start = fromDateKey("2026-08-31", TZ);
    expect(toDateKey(addDaysInZone(start, 1, TZ), TZ)).toBe("2026-09-01");
    expect(toDateKey(addDaysInZone(start, -31, TZ), TZ)).toBe("2026-07-31");
  });

  it("reports minutes since local midnight", () => {
    expect(minutesOfDay(new Date("2026-08-14T18:30:00.000Z"), TZ)).toBe(0);
    expect(minutesOfDay(new Date("2026-08-14T17:30:00.000Z"), TZ)).toBe(23 * 60);
  });

  it("handles a timezone with a daylight saving shift", () => {
    // London is UTC+1 in August.
    expect(startOfDayInZone(new Date("2026-08-14T12:00:00.000Z"), "Europe/London").toISOString()).toBe(
      "2026-08-13T23:00:00.000Z",
    );
    // …and UTC+0 in January.
    expect(startOfDayInZone(new Date("2026-01-14T12:00:00.000Z"), "Europe/London").toISOString()).toBe(
      "2026-01-14T00:00:00.000Z",
    );
  });
});

describe("time formatting", () => {
  it("parses and formats HH:mm", () => {
    expect(parseHHmm("23:00")).toBe(1380);
    expect(parseHHmm("06:30")).toBe(390);
    expect(formatHHmm(1380)).toBe("23:00");
    expect(() => parseHHmm("25:00")).toThrow();
    expect(() => parseHHmm("nonsense")).toThrow();
  });

  it("formats a running timer", () => {
    expect(formatDurationHMS(0)).toBe("00:00:00");
    expect(formatDurationHMS(5842)).toBe("01:37:22");
    expect(formatDurationHMS(-10)).toBe("00:00:00");
  });

  it("formats a human duration", () => {
    expect(formatDurationHuman(155)).toBe("2h 35m");
    expect(formatDurationHuman(120)).toBe("2h");
    expect(formatDurationHuman(45)).toBe("45m");
  });
});
