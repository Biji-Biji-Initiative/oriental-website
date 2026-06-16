import { describe, expect, it } from "vitest";
import { getSegment, SEGMENT_IDS, segmentOptions } from "@/lib/segments";

describe("segments", () => {
  it("exposes the six launch routing segments", () => {
    expect(segmentOptions()).toHaveLength(6);
    expect(SEGMENT_IDS).toContain("tenancy");
    expect(SEGMENT_IDS).toContain("technology");
    expect(SEGMENT_IDS).toContain("other");
    expect(SEGMENT_IDS).not.toContain("ai");
    expect(SEGMENT_IDS).not.toContain("cultural");
  });

  it("falls back unknown values to other", () => {
    expect(getSegment("unknown").routedTo.name).toBe("Nadia");
  });
});
