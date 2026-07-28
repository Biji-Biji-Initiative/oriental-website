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
  it("keeps every reconnect sharing a nonempty conversation id together", () => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId: " conv-1 ", updatedAt: 1000 }),
      session({ reviewId: "b", conversationId: "conv-1", updatedAt: 2000 }),
    ]);

    expect(heads).toHaveLength(1);
    expect(heads[0]?.reviewId).toBe("b");
    expect(heads[0]?.calls.map((call) => call.reviewId)).toEqual(["a", "b"]);
  });

  it.each(["", "   "])("treats %j as a missing conversation id", (conversationId) => {
    const heads = collapseConversations([
      session({ reviewId: "a", conversationId, updatedAt: 1000 }),
      session({ reviewId: "b", conversationId, updatedAt: 2000 }),
    ]);

    expect(heads).toHaveLength(2);
  });

  it("namespaces explicit conversation ids away from legacy review ids", () => {
    const heads = collapseConversations([
      session({ reviewId: "explicit-call", conversationId: "legacy-id", updatedAt: 1000 }),
      session({ reviewId: "legacy-id", conversationId: null, updatedAt: 2000 }),
    ]);

    expect(heads).toHaveLength(2);
  });

  it("stitches different explicit ids with one consistent normalized email inside the window", () => {
    const heads = collapseConversations([
      session({
        reviewId: "a",
        conversationId: "conv-1",
        updatedAt: 1000,
        capturedEmailNormalized: " Sam@Carter.com ",
      }),
      session({
        reviewId: "b",
        conversationId: "conv-2",
        updatedAt: 1000 + CONVERSATION_STITCH_WINDOW_MS,
        capturedEmailNormalized: "sam@carter.com",
      }),
    ]);

    expect(heads).toHaveLength(1);
    expect(heads[0]?.calls.map((call) => call.reviewId)).toEqual(["a", "b"]);
  });

  it("does not stitch the same email once the nearest actual-call gap exceeds the window", () => {
    const heads = collapseConversations([
      session({
        reviewId: "a",
        conversationId: "conv-1",
        updatedAt: 1000,
        capturedEmailNormalized: "sam@carter.com",
      }),
      session({
        reviewId: "b",
        conversationId: "conv-2",
        updatedAt: 1000 + CONVERSATION_STITCH_WINDOW_MS + 1,
        capturedEmailNormalized: "sam@carter.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
  });

  it("never stitches anonymous, raw-only, malformed, or different-email units", () => {
    const heads = collapseConversations([
      session({ reviewId: "anonymous", conversationId: "anonymous", updatedAt: 1000 }),
      session({
        reviewId: "raw-only",
        conversationId: "raw-only",
        updatedAt: 1100,
        captured: { email: "sam@carter.com" },
      }),
      session({
        reviewId: "malformed",
        conversationId: "malformed",
        updatedAt: 1200,
        capturedEmailNormalized: "not-an-email",
      }),
      session({
        reviewId: "alice",
        conversationId: "alice",
        updatedAt: 1300,
        capturedEmailNormalized: "alice@example.com",
      }),
      session({
        reviewId: "bob",
        conversationId: "bob",
        updatedAt: 1400,
        capturedEmailNormalized: "bob@example.com",
      }),
    ]);

    expect(heads).toHaveLength(5);
  });

  it("keeps an explicit unit together but denies inferred edges when its normalized emails conflict", () => {
    const heads = collapseConversations([
      session({
        reviewId: "wrong",
        conversationId: "conv-conflict",
        updatedAt: 1000,
        capturedEmailNormalized: "wrong@example.com",
      }),
      session({
        reviewId: "right",
        conversationId: "conv-conflict",
        updatedAt: 2000,
        capturedEmailNormalized: "right@example.com",
      }),
      session({
        reviewId: "external",
        conversationId: "conv-external",
        updatedAt: 2500,
        capturedEmailNormalized: "wrong@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "right")?.calls.map((call) => call.reviewId)).toEqual([
      "wrong",
      "right",
    ]);
    expect(heads.find((head) => head.reviewId === "external")?.calls).toHaveLength(1);
  });

  it("denies inferred edges when any call in an explicit unit lacks normalized identity", () => {
    const heads = collapseConversations([
      session({
        reviewId: "identified",
        conversationId: "conv-partial",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({ reviewId: "anonymous", conversationId: "conv-partial", updatedAt: 2000 }),
      session({
        reviewId: "external",
        conversationId: "conv-external",
        updatedAt: 2500,
        capturedEmailNormalized: "same@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "anonymous")?.calls).toHaveLength(2);
  });

  it("does not let a sparse explicit history create a continuous ten-hour interval", () => {
    const tenHours = 10 * CONVERSATION_STITCH_WINDOW_MS;
    const heads = collapseConversations([
      session({
        reviewId: "start",
        conversationId: "conv-sparse",
        updatedAt: 0,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "end",
        conversationId: "conv-sparse",
        updatedAt: tenHours,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "middle",
        conversationId: "conv-middle",
        updatedAt: tenHours / 2,
        capturedEmailNormalized: "same@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "end")?.calls.map((call) => call.reviewId)).toEqual(["start", "end"]);
  });

  it("selects the nearest compatible conversation when several same-email clusters exist", () => {
    const heads = collapseConversations([
      session({
        reviewId: "old",
        conversationId: "conv-old",
        updatedAt: 0,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "near",
        conversationId: "conv-near",
        updatedAt: 3 * CONVERSATION_STITCH_WINDOW_MS,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "resume",
        conversationId: "conv-resume",
        updatedAt: 3 * CONVERSATION_STITCH_WINDOW_MS + 1000,
        capturedEmailNormalized: "same@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "resume")?.calls.map((call) => call.reviewId)).toEqual([
      "near",
      "resume",
    ]);
  });

  it("is deterministic under input permutations and equal timestamps", () => {
    const calls = [
      session({
        reviewId: "a",
        conversationId: "conv-a",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "b",
        conversationId: "conv-b",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({ reviewId: "z", conversationId: "conv-z", updatedAt: 1000 }),
    ];
    const project = (input: StitchableSession[]) =>
      collapseConversations(input).map((head) => ({
        head: head.reviewId,
        calls: head.calls.map((call) => call.reviewId),
      }));

    expect(project(calls)).toEqual(project([...calls].reverse()));
    expect(project(calls)).toEqual([
      { head: "z", calls: ["z"] },
      { head: "b", calls: ["a", "b"] },
    ]);
  });

  it("does not mutate input rows or their ordering", () => {
    const calls = [
      session({
        reviewId: "b",
        conversationId: "conv-b",
        updatedAt: 2000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "a",
        conversationId: "conv-a",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
    ];
    const before = structuredClone(calls);

    collapseConversations(calls);

    expect(calls).toEqual(before);
  });
});
