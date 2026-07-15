import { describe, expect, it } from "vitest";
import { lookupOrientalKnowledge } from "@/lib/voice/knowledge";

describe("Oriental voice knowledge lookup", () => {
  it("returns a bounded published answer for office-size questions", () => {
    const result = lookupOrientalKnowledge({ topic: "pricing", query: "full floor office size" });
    expect(result.matches.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(result.matches)).toContain("2,800–3,000 sq ft");
  });

  it("does not invent a result when published knowledge has no match", () => {
    const result = lookupOrientalKnowledge({ topic: "pricing", query: "cryptocurrency payment discount" });
    expect(result.matches).toEqual([]);
    expect(result.guidance).toContain("Capture the question for the team");
  });

  it("normalizes unknown topics to the bounded general corpus", () => {
    const result = lookupOrientalKnowledge({ topic: "internet", query: "opening 2027" });
    expect(result.topic).toBe("general");
    expect(result.matches.length).toBeGreaterThan(0);
  });
});
