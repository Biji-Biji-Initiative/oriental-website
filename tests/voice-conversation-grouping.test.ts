import { describe, expect, it } from "vitest";
import {
  CONVERSATION_STITCH_WINDOW_MS,
  collapseConversations,
  type StitchableSession,
} from "@/lib/voice-conversation-grouping";

function session(overrides: Partial<StitchableSession> & { reviewId: string; updatedAt: number }): StitchableSession {
  return { conversationId: null, capturedEmailNormalized: null, captured: null, ...overrides };
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest]),
  );
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
        capturedEmailNormalized: "sam@carter.com",
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
    const window = CONVERSATION_STITCH_WINDOW_MS;
    const heads = collapseConversations([
      session({
        reviewId: "a-start",
        conversationId: "conv-a",
        updatedAt: 0,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "a-end",
        conversationId: "conv-a",
        updatedAt: 5.8 * window,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "b",
        conversationId: "conv-b",
        updatedAt: 4.5 * window,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "resume",
        conversationId: "conv-resume",
        updatedAt: 5.1 * window,
        capturedEmailNormalized: "same@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "a-end")?.calls.map((call) => call.reviewId)).toEqual([
      "a-start",
      "a-end",
    ]);
    expect(heads.find((head) => head.reviewId === "resume")?.calls.map((call) => call.reviewId)).toEqual([
      "b",
      "resume",
    ]);
  });

  it("uses the exact canonical cluster key for an equal-gap tie under every input permutation", () => {
    const window = CONVERSATION_STITCH_WINDOW_MS;
    const calls = [
      session({
        reviewId: "a-start",
        conversationId: "é",
        updatedAt: 0,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "a-end",
        conversationId: "é",
        updatedAt: 6 * window,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "b",
        conversationId: "e\u0301",
        updatedAt: 4 * window,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "bridge",
        conversationId: "conv-bridge",
        updatedAt: 5 * window,
        capturedEmailNormalized: "same@example.com",
      }),
    ];
    const project = (input: StitchableSession[]) =>
      collapseConversations(input).map((head) => ({
        head: head.reviewId,
        calls: head.calls.map((call) => call.reviewId),
      }));
    const expected = [
      { head: "a-end", calls: ["a-start", "a-end"] },
      { head: "bridge", calls: ["b", "bridge"] },
    ];

    for (const permutation of permutations(calls)) expect(project(permutation)).toEqual(expected);
  });

  it("orders canonically distinct Unicode opaque ids exactly under every permutation", () => {
    const calls = [
      session({ reviewId: "é", conversationId: "conv", updatedAt: 1000 }),
      session({ reviewId: "e\u0301", conversationId: "conv", updatedAt: 1000 }),
    ];

    for (const permutation of permutations(calls)) {
      const [head] = collapseConversations(permutation);
      expect(head?.reviewId).toBe("é");
      expect(head?.calls.map((call) => call.reviewId)).toEqual(["e\u0301", "é"]);
    }
  });

  it("never gives matching raw-only email values identity authority", () => {
    const heads = collapseConversations([
      session({
        reviewId: "raw-a",
        conversationId: "raw-a",
        updatedAt: 1000,
        captured: { email: "same@example.com" },
      }),
      session({
        reviewId: "raw-b",
        conversationId: "raw-b",
        updatedAt: 1100,
        captured: { email: "same@example.com" },
      }),
    ]);

    expect(heads).toHaveLength(2);
  });

  it.each([
    "a..b@example.com",
    "a@example..com",
    "a@example.com\0",
    " spaced@example.com",
  ])("never gives matching malformed normalized values identity authority: %j", (capturedEmailNormalized) => {
    const heads = collapseConversations([
      session({ reviewId: "bad-a", conversationId: "bad-a", updatedAt: 1000, capturedEmailNormalized }),
      session({ reviewId: "bad-b", conversationId: "bad-b", updatedAt: 1100, capturedEmailNormalized }),
    ]);

    expect(heads).toHaveLength(2);
  });

  it.each([
    "Same@example.com",
    "same@Example.com",
  ])("never gives matching noncanonical normalized values identity authority: %j", (capturedEmailNormalized) => {
    const heads = collapseConversations([
      session({ reviewId: "bad-a", conversationId: "bad-a", updatedAt: 1000, capturedEmailNormalized }),
      session({ reviewId: "bad-b", conversationId: "bad-b", updatedAt: 1100, capturedEmailNormalized }),
    ]);

    expect(heads).toHaveLength(2);
  });

  it("keeps a mixed canonical/noncanonical explicit unit together but denies every inferred edge", () => {
    const heads = collapseConversations([
      session({
        reviewId: "canonical-in-unit",
        conversationId: "mixed",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "noncanonical-in-unit",
        conversationId: "mixed",
        updatedAt: 1100,
        capturedEmailNormalized: "Same@example.com",
      }),
      session({
        reviewId: "canonical-external",
        conversationId: "external",
        updatedAt: 1200,
        capturedEmailNormalized: "same@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "noncanonical-in-unit")?.calls.map((call) => call.reviewId)).toEqual([
      "canonical-in-unit",
      "noncanonical-in-unit",
    ]);
    expect(heads.find((head) => head.reviewId === "canonical-external")?.calls).toHaveLength(1);
  });

  it("keeps a wholly noncanonical explicit unit separate from a canonical external unit", () => {
    const heads = collapseConversations([
      session({
        reviewId: "noncanonical-a",
        conversationId: "noncanonical-unit",
        updatedAt: 1000,
        capturedEmailNormalized: "Same@example.com",
      }),
      session({
        reviewId: "noncanonical-b",
        conversationId: "noncanonical-unit",
        updatedAt: 1100,
        capturedEmailNormalized: "Same@example.com",
      }),
      session({
        reviewId: "canonical-external",
        conversationId: "external",
        updatedAt: 1200,
        capturedEmailNormalized: "same@example.com",
      }),
    ]);

    expect(heads).toHaveLength(2);
    expect(heads.find((head) => head.reviewId === "noncanonical-b")?.calls.map((call) => call.reviewId)).toEqual([
      "noncanonical-a",
      "noncanonical-b",
    ]);
    expect(heads.find((head) => head.reviewId === "canonical-external")?.calls).toHaveLength(1);
  });

  it("preserves every original row reference exactly once across all grouping branches", () => {
    const calls = [
      session({ reviewId: "explicit-a", conversationId: "explicit", updatedAt: 0 }),
      session({ reviewId: "explicit-b", conversationId: "explicit", updatedAt: 1 }),
      session({
        reviewId: "inferred-a",
        conversationId: "inferred-a",
        updatedAt: 10,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "inferred-b",
        conversationId: "inferred-b",
        updatedAt: 11,
        capturedEmailNormalized: "same@example.com",
      }),
      session({ reviewId: "raw-a", conversationId: "raw-a", updatedAt: 20, captured: { email: "raw@example.com" } }),
      session({ reviewId: "raw-b", conversationId: "raw-b", updatedAt: 21, captured: { email: "raw@example.com" } }),
      session({ reviewId: "standalone", updatedAt: 30 }),
    ];

    const flattened = collapseConversations(calls).flatMap((head) => head.calls);
    expect(flattened).toHaveLength(calls.length);
    expect(new Set(flattened).size).toBe(calls.length);
    for (const call of calls) expect(flattened.filter((candidate) => candidate === call)).toHaveLength(1);
  });

  it("is deterministic under all six input permutations with canonically distinct Unicode ids", () => {
    const calls = [
      session({
        reviewId: "e\u0301",
        conversationId: "e\u0301",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({
        reviewId: "é",
        conversationId: "é",
        updatedAt: 1000,
        capturedEmailNormalized: "same@example.com",
      }),
      session({ reviewId: "Ω", conversationId: "Ω", updatedAt: 1000 }),
    ];
    const project = (input: StitchableSession[]) =>
      collapseConversations(input).map((head) => ({
        head: head.reviewId,
        calls: head.calls.map((call) => call.reviewId),
      }));

    const expected = [
      { head: "Ω", calls: ["Ω"] },
      { head: "é", calls: ["e\u0301", "é"] },
    ];
    expect(permutations(calls)).toHaveLength(6);
    for (const permutation of permutations(calls)) expect(project(permutation)).toEqual(expected);
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
