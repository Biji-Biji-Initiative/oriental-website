import { describe, expect, it } from "vitest";
import { rateLimitResponseHeaders, requestIp } from "@/lib/server/security";

function request(headers: HeadersInit) {
  return new Request("https://oriental.mereka.io/api/voice/session", { headers }) as never;
}

describe("requestIp", () => {
  it("uses the proxy-owned rightmost valid forwarded address", () => {
    expect(requestIp(request({ "x-forwarded-for": "198.51.100.20, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("ignores a client-supplied Cloudflare address at the direct origin", () => {
    expect(
      requestIp(
        request({
          "cf-connecting-ip": "198.51.100.99",
          "x-forwarded-for": "203.0.113.9",
        }),
      ),
    ).toBe("203.0.113.9");
  });

  it("fails closed when proxy metadata is missing or malformed", () => {
    expect(requestIp(request({ "cf-connecting-ip": "198.51.100.99" }))).toBe("0.0.0.0");
    expect(requestIp(request({ "x-forwarded-for": "not-an-ip" }))).toBe("0.0.0.0");
    expect(
      requestIp(
        request({
          "x-forwarded-for": "not-an-ip",
          "x-real-ip": "198.51.100.99",
        }),
      ),
    ).toBe("0.0.0.0");
  });
});

describe("rateLimitResponseHeaders", () => {
  it("emits a positive Retry-After and an absolute reset time", () => {
    expect(rateLimitResponseHeaders(1_700_000_061_500, 1_700_000_000_000)).toEqual({
      "Retry-After": "62",
      "X-RateLimit-Reset": "1700000062",
    });
  });

  it("never asks a client to retry immediately", () => {
    expect(rateLimitResponseHeaders(1_699_999_999_000, 1_700_000_000_000)["Retry-After"]).toBe("1");
  });
});
