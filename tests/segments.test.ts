import { describe, expect, it } from "vitest";
import { getSegment, SEGMENT_IDS, segmentOptions } from "@/lib/segments";

describe("segments", () => {
  it("exposes the eight launch routing segments", () => {
    expect(segmentOptions()).toHaveLength(8);
    expect(SEGMENT_IDS).toContain("tenancy");
    expect(SEGMENT_IDS).toContain("ai");
    expect(SEGMENT_IDS).toContain("other");
  });

  it("falls back unknown values to other", () => {
    expect(getSegment("unknown").routedTo.name).toBe("Nadia");
  });
});
