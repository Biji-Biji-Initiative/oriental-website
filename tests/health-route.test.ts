import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

describe("health route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the non-secret live release and voice cells", async () => {
    vi.stubEnv("GIT_SHA", "1234567890abcdef1234567890abcdef12345678");
    vi.stubEnv("CONVEX_URL", "https://example.convex.cloud");
    vi.stubEnv("VOICE_RUNTIME_PROFILE", "instant-v1");
    vi.stubEnv("VOICE_MODEL_CELL", "candidate");
    vi.stubEnv("OPENAI_REALTIME_MODEL_CANDIDATE", "gpt-realtime-2.1");
    vi.stubEnv("VOICE_REASONING_CELL", "minimal");
    vi.stubEnv("VOICE_EMAIL_CAPTURE_MODE", "adaptive");
    vi.stubEnv("VOICE_VARIANT_PICKER", "true");

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      ok: true,
      version: "1234567890abcdef1234567890abcdef12345678",
      convex: true,
      voice: {
        runtime_profile: "instant-v1",
        model_cell: "candidate",
        model: "gpt-realtime-2.1",
        reasoning_cell: "minimal",
        email_capture_mode: "adaptive",
        variant_picker: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
  });
});
