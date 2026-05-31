import { describe, expect, it } from "vitest";
import { adminLeadWorkflowSchema, leadRequestSchema } from "@/lib/schemas";

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

describe("admin lead workflow schema", () => {
  it("accepts trimmed workflow updates", () => {
    const parsed = adminLeadWorkflowSchema.safeParse({
      status: "contacted",
      priority: "high",
      owner: "  Gurpreet  ",
      note: "  WhatsApp intro sent.  ",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.owner).toBe("Gurpreet");
      expect(parsed.data.note).toBe("WhatsApp intro sent.");
    }
  });

  it("rejects unknown workflow states", () => {
    expect(adminLeadWorkflowSchema.safeParse({ status: "done", priority: "normal", owner: "", note: "" }).success).toBe(
      false,
    );
  });
});
