import { afterEach, describe, expect, it, vi } from "vitest";
import { readTunerFlag } from "@/components/voice-agent/voice-tuner";

function configResponse(enabled: boolean) {
  return Promise.resolve(
    new Response(JSON.stringify({ voiceVariantPicker: enabled }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }),
  );
}

describe("voice tuner runtime governance", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("fails closed in production even when the browser query requests voices", async () => {
    window.history.replaceState({}, "", "/?voices=1");
    const fetcher = vi.fn(() => configResponse(false));

    await expect(readTunerFlag(fetcher, "production")).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledWith("/api/client-config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("lets an enabled QA environment show the picker", async () => {
    const fetcher = vi.fn(() => configResponse(true));
    await expect(readTunerFlag(fetcher, "production")).resolves.toBe(true);
  });

  it("does not let URL or browser storage hide an enabled governed picker", async () => {
    const fetcher = vi.fn(() => configResponse(true));
    window.history.replaceState({}, "", "/?voices=0");
    window.localStorage.setItem("oriental.voiceTunerHidden", "1");

    await expect(readTunerFlag(fetcher, "production")).resolves.toBe(true);
  });

  it("fails closed when runtime config cannot be read", async () => {
    const fetcher = vi.fn<typeof window.fetch>().mockRejectedValue(new Error("config unavailable"));
    await expect(readTunerFlag(fetcher, "production")).resolves.toBe(false);
  });

  it("keeps the tuner available in development without a runtime request", async () => {
    const fetcher = vi.fn(() => configResponse(false));
    await expect(readTunerFlag(fetcher, "development")).resolves.toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
