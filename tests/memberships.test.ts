import { describe, expect, it } from "vitest";

import { activeCoverage, isCovered, type MembershipTerm } from "@/lib/memberships";

/**
 * Which membership term is in force.
 *
 * The rule that broke real bills: "the term with the latest end date" is not
 * the term in force, because renewals stack — buying a renewal early creates a
 * row that starts on the day the current one ends.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-08-15T10:00:00.000Z");

function term(id: string, startsInDays: number, endsInDays: number): MembershipTerm {
  return {
    id,
    startDate: new Date(NOW.getTime() + startsInDays * DAY),
    endDate: new Date(NOW.getTime() + endsInDays * DAY),
  };
}

describe("the membership term in force", () => {
  it("finds nothing for a member with no terms", () => {
    expect(activeCoverage([], NOW)).toBeNull();
    expect(isCovered([], NOW)).toBe(false);
  });

  it("finds the term the member is inside", () => {
    const current = term("a", -10, 20);
    const coverage = activeCoverage([current], NOW);
    expect(coverage?.term.id).toBe("a");
    expect(coverage?.validUntil).toEqual(current.endDate);
  });

  it("finds nothing when every term has expired", () => {
    expect(activeCoverage([term("a", -400, -30), term("b", -30, -1)], NOW)).toBeNull();
  });

  it("finds nothing when the only term has not begun", () => {
    // A membership sold today but dated to start next month.
    expect(activeCoverage([term("a", 30, 395)], NOW)).toBeNull();
  });

  it("follows a renewal stacked on top of the current term", () => {
    // This is the case that charged paid-up members full price: the renewal has
    // the latest end date, but it has not started yet.
    const current = term("current", -10, 20);
    const renewal = term("renewal", 20, 385);
    const coverage = activeCoverage([renewal, current], NOW);

    expect(coverage?.term.id).toBe("current");
    expect(coverage?.validUntil).toEqual(renewal.endDate);
  });

  it("follows a whole chain of stacked renewals", () => {
    const coverage = activeCoverage(
      [term("third", 50, 100), term("current", -5, 20), term("second", 20, 50)],
      NOW,
    );
    expect(coverage?.term.id).toBe("current");
    expect(coverage?.validUntil).toEqual(new Date(NOW.getTime() + 100 * DAY));
  });

  it("stops at a gap in cover", () => {
    // They let it lapse for a week before buying again — cover ends at the gap.
    const current = term("current", -10, 20);
    const later = term("later", 27, 390);
    const coverage = activeCoverage([current, later], NOW);

    expect(coverage?.term.id).toBe("current");
    expect(coverage?.validUntil).toEqual(current.endDate);
  });

  it("ignores a short renewal that ends before cover would lapse anyway", () => {
    const current = term("current", -10, 200);
    const shortOne = term("short", 5, 30);
    expect(activeCoverage([current, shortOne], NOW)?.validUntil).toEqual(current.endDate);
  });

  it("counts the first moment of a term and not the last", () => {
    const starting = term("starting", 0, 30);
    expect(activeCoverage([starting], NOW)?.term.id).toBe("starting");

    // A term ending exactly now is over: cover is up to, but not including, the
    // end instant, which is what the pricing engine assumes when it splits a
    // session at the moment a membership runs out.
    const ending = term("ending", -30, 0);
    expect(activeCoverage([ending], NOW)).toBeNull();
  });

  it("does not care what order the terms arrive in", () => {
    const terms = [term("renewal", 20, 385), term("old", -400, -40), term("current", -10, 20)];
    for (const shuffled of [terms, [...terms].reverse(), [terms[1], terms[2], terms[0]]]) {
      const coverage = activeCoverage(shuffled, NOW);
      expect(coverage?.term.id).toBe("current");
      expect(coverage?.validUntil).toEqual(new Date(NOW.getTime() + 385 * DAY));
    }
  });
});
