import { describe, expect, it } from "vitest";
import {
  boundTranscript,
  MAX_TRANSCRIPT_CHARACTERS,
  normalizeStoredEmail,
  transcriptCharacterCount,
} from "@/lib/data-payload";

describe("bounded stored payloads", () => {
  it("normalizes email identity without preserving surrounding whitespace or case", () => {
    expect(normalizeStoredEmail("  Visitor@Example.COM ")).toBe("visitor@example.com");
  });

  it("keeps the newest transcript turns inside one aggregate character budget", () => {
    const transcript = [
      { role: "user", text: "old".repeat(2_000) },
      { role: "assistant", text: "middle".repeat(1_000) },
      { role: "user", text: "new".repeat(2_000) },
    ];

    const bounded = boundTranscript(transcript);

    expect(transcriptCharacterCount(bounded)).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARACTERS);
    expect(bounded.at(-1)).toEqual(transcript.at(-1));
    expect(bounded).not.toBe(transcript);
  });
});
