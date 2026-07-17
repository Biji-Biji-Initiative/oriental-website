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

  it("serves a valid GA measurement id from runtime env", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "G-52MHKNK87D");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ gaMeasurementId: "G-52MHKNK87D" });
  });

  it("returns null instead of a malformed GA id", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "<script>alert(1)</script>");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ gaMeasurementId: null });
  });

  it("returns null when GA is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ gaMeasurementId: null });
  });
});
