import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression tests for member lookup, run against a real seeded database.
 *
 * These exist because the station dialog once reported every member as having
 * no membership: the query used a correlated subquery written with raw `sql`,
 * whose interpolated column names render unqualified, so `members.id` bound to
 * `memberships.id` and matched nothing. Unit tests could not have caught it —
 * only real SQL against real rows.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

let pool: { end: () => Promise<void> } | undefined;

afterAll(async () => {
  await pool?.end();
});

describeIfDb("member lookup against the database", () => {
  it("reports the same membership status in the member list and the session search", async () => {
    const { listMembers, searchMembers } = await import("@/server/services/members");
    ({ pool } = await import("@/db"));

    const everyone = await listMembers();
    expect(everyone.length, "seed the database first: npm run db:seed").toBeGreaterThan(0);

    const withMembership = everyone.filter((member) => member.membershipEnd !== null);
    expect(withMembership.length, "expected at least one seeded member with a membership").toBeGreaterThan(0);

    for (const member of withMembership) {
      const hits = await searchMembers(member.fullName);
      const found = hits.find((hit) => hit.id === member.id);

      expect(found, `${member.fullName} should be findable by name`).toBeDefined();
      // The bug: this came back null for members who clearly had a membership.
      expect(found!.validUntil, `${member.fullName} should carry a membership end date`).not.toBeNull();
      expect(new Date(found!.validUntil!).toISOString()).toBe(member.membershipEnd!.toISOString());
      // …which made an active member look expired in the start-session dialog.
      expect(found!.membershipStatus).toBe(member.membershipStatus);
    }
  });

  it("finds a member by mobile number and by member code", async () => {
    const { listMembers, searchMembers } = await import("@/server/services/members");
    const [member] = await listMembers();

    const byMobile = await searchMembers(member.mobile);
    expect(byMobile.some((hit) => hit.id === member.id)).toBe(true);

    const byCode = await searchMembers(member.memberCode);
    expect(byCode.some((hit) => hit.id === member.id)).toBe(true);
  });

  it("ignores searches that are too short to be useful", async () => {
    const { searchMembers } = await import("@/server/services/members");
    expect(await searchMembers("a")).toEqual([]);
  });
});
