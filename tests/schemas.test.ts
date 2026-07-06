import { describe, expect, it } from "vitest";
import { adminLeadWorkflowSchema, adminLoginSchema, leadRequestSchema } from "@/lib/schemas";

describe("lead request schema", () => {
  it("accepts a complete form lead", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "form",
      segment: "technology",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "We want to run public AI literacy demos with community groups.",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts voice review linkage metadata on submitted voice leads", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "voice",
      segment: "technology",
      voiceReviewId: "5a8c25b1-cd50-4e47-89bf-84947c805add",
      voiceReviewToken: "5a8c25b1-cd50-4e47-89bf-84947c805add.1799999999999.signature",
      voiceSessionId: "sess_123",
      voiceVariant: "kl-polished",
      voiceModel: "gpt-realtime-2",
      voiceName: "marin",
      voiceSpeed: 1.22,
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "We want to run public AI literacy demos.",
      },
      transcript: [{ role: "user", text: "hello" }],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects transcripts beyond the 200-entry cap", () => {
    const parsed = leadRequestSchema.safeParse({
      source: "voice",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "AI literacy demos.",
      },
      transcript: Array.from({ length: 201 }, () => ({ role: "user", text: "hello" })),
    });
    expect(parsed.success).toBe(false);
  });

  it("bounds utm key count and value lengths", () => {
    const base = {
      source: "form",
      form: {
        name: "Asha",
        email: "asha@example.com",
        org: "Future Lab",
        phone: "",
        website: "",
        message: "AI literacy demos.",
      },
    };

    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, "v"]));
    expect(leadRequestSchema.safeParse({ ...base, utm: tooMany }).success).toBe(false);

    expect(leadRequestSchema.safeParse({ ...base, utm: { source: "x".repeat(301) } }).success).toBe(false);
    expect(leadRequestSchema.safeParse({ ...base, utm: { utm_source: "newsletter" } }).success).toBe(true);
  });
});

describe("admin login schema", () => {
  it("accepts the shared admin password length", () => {
    expect(adminLoginSchema.safeParse({ token: "Cr3ativity" }).success).toBe(true);
  });

  it("accepts long generated admin review tokens", () => {
    expect(adminLoginSchema.safeParse({ token: `admin-${"x".repeat(600)}` }).success).toBe(true);
  });

  it("rejects very short admin tokens", () => {
    expect(adminLoginSchema.safeParse({ token: "short" }).success).toBe(false);
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
