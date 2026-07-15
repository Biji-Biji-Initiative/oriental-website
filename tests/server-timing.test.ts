import { describe, expect, it } from "vitest";
import { serializeServerTiming } from "@/lib/server/server-timing";

describe("serializeServerTiming", () => {
  it("emits bounded duration metrics without labels or secrets", () => {
    expect(serializeServerTiming({ parse: 1.234, rate_limit: 8, openai_mint: 302.56, total: 320 })).toBe(
      "parse;dur=1.2, rate_limit;dur=8.0, openai_mint;dur=302.6, total;dur=320.0",
    );
  });

  it("drops undefined and non-finite measurements", () => {
    expect(serializeServerTiming({ parse: undefined, total: Number.NaN })).toBe("");
  });
});
