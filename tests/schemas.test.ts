import { describe, expect, it } from "vitest";
import { leadRequestSchema } from "@/lib/schemas";

describe("lead request schema", () => {
  it("accepts a complete form lead", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "form",
      segment: "technology",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        message: "We want to run public AI literacy demos with community groups.",
      },
    });
    expect(parsed.success).toBe(true);
  });
});
