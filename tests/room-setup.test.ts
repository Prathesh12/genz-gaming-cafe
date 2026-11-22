import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const setupSql = readFileSync(join(process.cwd(), "scripts", "setup-playstation-rooms.sql"), "utf8");

describe("PlayStation room setup script", () => {
  it("represents exactly Room 01 through Room 17 without fixed console assignments", () => {
    expect(setupSql).toContain("generate_series(1, 17)");
    expect(setupSql).toContain("default_playstation_type");
    expect(setupSql).not.toMatch(/ROOM-0[1-9].*PS[45]/);
  });

  it("is idempotent and rolls back if all 17 valid rooms cannot be represented", () => {
    expect(setupSql).toContain("ON CONFLICT DO NOTHING");
    expect(setupSql).toContain("IF configured_rooms <> 17");
    expect(setupSql).toContain("transaction rolled back");
  });

  it("refuses to repurpose a colliding legacy station", () => {
    expect(setupSql).toContain("category.pricing_model <> 'ROOM'");
    expect(setupSql).toContain("not a matching PlayStation room");
  });
});
