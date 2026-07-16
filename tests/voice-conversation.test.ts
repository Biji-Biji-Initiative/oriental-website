import { beforeEach, describe, expect, it } from "vitest";
import { isConversationId, resolveConversationId } from "@/lib/voice/conversation";

describe("voice conversation continuity", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("generates and reuses a valid UUID inside the continuation window", () => {
    const first = resolveConversationId(1_000);
    const resumed = resolveConversationId(2_000);

    expect(isConversationId(first)).toBe(true);
    expect(resumed).toBe(first);
  });

  it("replaces a malformed legacy storage id", () => {
    window.sessionStorage.setItem(
      "oriental:voice:conversation",
      JSON.stringify({ id: "legacy-conversation-id", at: 1_000 }),
    );

    const resolved = resolveConversationId(2_000);
    expect(resolved).not.toBe("legacy-conversation-id");
    expect(isConversationId(resolved)).toBe(true);
  });
});
