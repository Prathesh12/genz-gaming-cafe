import { describe, expect, it } from "vitest";

import { describeError } from "@/lib/errors";

describe("database error translation", () => {
  it("unwraps a Drizzle query error before mapping a duplicate pricing rule", () => {
    const result = describeError({
      message: "Failed query",
      cause: { code: "23505", constraint: "pricing_rules_unique" },
    });

    expect(result).toEqual({
      code: "DUPLICATE",
      message: "A price already exists for that category, duration and player count. Edit that existing price instead.",
    });
  });
});
