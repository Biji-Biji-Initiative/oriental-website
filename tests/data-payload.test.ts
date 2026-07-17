import { describe, expect, it } from "vitest";
import {
  boundTranscript,
  MAX_TRANSCRIPT_BYTES,
  MAX_TRANSCRIPT_CHARACTERS,
  normalizeStoredEmail,
  transcriptByteCount,
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

  it("enforces the UTF-8 byte ceiling for multibyte transcripts", () => {
    const transcript = [
      { role: "assistant", text: "舊".repeat(8_000) },
      { role: "user", text: "🤝".repeat(5_000) },
    ];

    const bounded = boundTranscript(transcript);

    expect(transcriptCharacterCount(bounded)).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARACTERS);
    expect(transcriptByteCount(bounded)).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
    expect(bounded.at(-1)?.text).toBe("🤝".repeat(4_000));
  });

  it("never splits a Unicode code point when truncating to the remaining budget", () => {
    const bounded = boundTranscript([{ role: "user", text: `a${"🤝".repeat(8_000)}` }]);
    const text = bounded[0]?.text ?? "";

    expect(text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARACTERS);
    expect(transcriptByteCount(bounded)).toBeLessThanOrEqual(MAX_TRANSCRIPT_BYTES);
    expect(text.endsWith("\ud83e")).toBe(false);
  });
});
