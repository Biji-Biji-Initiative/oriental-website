import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/client-config/route";

describe("client config route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the voice variant picker disabled by default", async () => {
    vi.stubEnv("VOICE_VARIANT_PICKER", "");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ voiceVariantPicker: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("enables the picker only for an explicit QA environment", async () => {
    vi.stubEnv("VOICE_VARIANT_PICKER", "true");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ voiceVariantPicker: true });
  });
});
