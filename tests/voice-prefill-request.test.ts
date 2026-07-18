import { describe, expect, it } from "vitest";
import { revokePrefillRequestEmail } from "@/lib/voice/prefill-request";

describe("versioned voice prefill requests", () => {
  it("consumes email PII without dropping the opening mode", () => {
    expect(revokePrefillRequestEmail({ id: 4, prefill: { email: "person@example.com", mode: "form" } }, 4)).toEqual({
      id: 4,
      prefill: { email: undefined, mode: "form" },
    });
  });

  it("does not let a late clear from request A revoke request B", () => {
    const current = { id: 5, prefill: { email: "new@example.com", mode: "voice" } };
    expect(revokePrefillRequestEmail(current, 4)).toBe(current);
  });

  it("allows the same literal again when a new explicit request owns it", () => {
    const first = revokePrefillRequestEmail({ id: 1, prefill: { email: "same@example.com" } }, 1);
    const second = { id: 2, prefill: { email: "same@example.com" } };
    expect(first?.prefill?.email).toBeUndefined();
    expect(revokePrefillRequestEmail(second, 1)).toBe(second);
    expect(second.prefill.email).toBe("same@example.com");
  });
});
