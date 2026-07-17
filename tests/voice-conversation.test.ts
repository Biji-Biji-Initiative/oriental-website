import { beforeEach, describe, expect, it } from "vitest";
import { isConversationId, resolveConversationId, shouldResumeVoiceConversation } from "@/lib/voice/conversation";

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

  it("resumes a reopened active conversation without repeating the opener", () => {
    const conversationId = resolveConversationId(1_000);
    expect(shouldResumeVoiceConversation(conversationId, resolveConversationId(2_000), 4)).toBe(true);
    expect(shouldResumeVoiceConversation(conversationId, crypto.randomUUID(), 4)).toBe(false);
    expect(shouldResumeVoiceConversation(conversationId, conversationId, 0)).toBe(false);
    expect(shouldResumeVoiceConversation(conversationId, conversationId, 4, true)).toBe(false);
  });
});
