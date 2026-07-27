import { describe, expect, it } from "vitest";
import {
  CONVERSATION_STITCH_WINDOW_MS,
  collapseConversations,
  type StitchableSession,
} from "@/lib/voice-conversation-grouping";

function session(overrides: Partial<StitchableSession> & { reviewId: string; updatedAt: number }): StitchableSession {
  return { conversationId: null, capturedEmailNormalized: null, captured: null, ...overrides };
}

describe("collapseConversations", () => {
  it("groups reconnects sharing a conversationId into one conversation", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId: "conv-1", updatedAt: 1000 }),
      session({ reviewId: "b", conversationId: "conv-1", updatedAt: 2000 }),
    ]);
    expect(heads).toHaveLength(1);
    expect(heads[0]?.reviewId).toBe("b"); // latest call heads
    expect(heads[0]?.calls.map((c) => c.reviewId)).toEqual(["a", "b"]); // chronological
  });

  it("stitches same-email sessions with different conversationIds within the window", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId: "conv-1", updatedAt: 1000, capturedEmailNormalized: "sam@carter.com" }),
      session({
        reviewId: "b",
        conversationId: "conv-2",
        updatedAt: 1000 + CONVERSATION_STITCH_WINDOW_MS - 1,
        capturedEmailNormalized: "sam@carter.com",
      }),
    ]);
    expect(heads).toHaveLength(1);
    expect(heads[0]?.calls.map((c) => c.reviewId)).toEqual(["a", "b"]);
  });

  it("does NOT stitch the same email once the gap exceeds the window", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId: "conv-1", updatedAt: 1000, capturedEmailNormalized: "sam@carter.com" }),
      session({
        reviewId: "b",
        conversationId: "conv-2",
        updatedAt: 1000 + CONVERSATION_STITCH_WINDOW_MS + 1,
        capturedEmailNormalized: "sam@carter.com",
      }),
    ]);
    expect(heads).toHaveLength(2);
  });

  it("never stitches anonymous sessions that have no captured email", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId: "conv-1", updatedAt: 1000 }),
      session({ reviewId: "b", conversationId: "conv-2", updatedAt: 1500 }),
    ]);
    expect(heads).toHaveLength(2);
  });

  it("treats the captured.email fallback and case/whitespace as the same person", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId: "conv-1", updatedAt: 1000, captured: { email: "Sam@Carter.com " } }),
      session({ reviewId: "b", conversationId: "conv-2", updatedAt: 2000, capturedEmailNormalized: "sam@carter.com" }),
    ]);
    expect(heads).toHaveLength(1);
  });

  it("keeps legacy rows without a conversationId as standalone conversations", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", updatedAt: 1000 }),
      session({ reviewId: "b", updatedAt: 2000 }),
    ]);
    expect(heads).toHaveLength(2);
    expect(heads.map((h) => h.reviewId)).toEqual(["b", "a"]); // newest first
  });
});
