import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEREKA_LOADER_EXIT_MS,
  MEREKA_LOADER_HOLD_MS,
  MerekaSiteLoader,
  merekaLoaderSessionKey,
  shouldShowMerekaSiteLoader,
} from "@/components/brand-motion/MerekaSiteLoader";
import { NebulaM, resolveMerekaMarkTarget } from "@/components/brand-motion/NebulaM";
import { MerekaMiniMark } from "@/components/orb/MerekaMiniMark";
import {
  BRAND_MOTION_PREVIEW_HOST,
  isBrandMotionPreviewEnabled,
  isBrandMotionPreviewHost,
  MEREKA_MARK_PATH,
  MEREKA_NEBULA_PARTICLE_COUNT,
  MEREKA_TRACE_DURATION_MS,
} from "@/lib/brand-motion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.style.overflow = "";
  window.sessionStorage.clear();
});

describe("Mereka brand motion", () => {
  it("keeps the measured motion contract", () => {
    expect(MEREKA_NEBULA_PARTICLE_COUNT).toBe(2_100);
    expect(MEREKA_TRACE_DURATION_MS).toBe(2_600);
  });

  it("requires both the build flag and an exact staging/local host for every motion preview", () => {
    expect(isBrandMotionPreviewEnabled(true, BRAND_MOTION_PREVIEW_HOST)).toBe(true);
    expect(isBrandMotionPreviewEnabled(false, BRAND_MOTION_PREVIEW_HOST)).toBe(false);
    expect(isBrandMotionPreviewEnabled(true, "oriental.mereka.io")).toBe(false);
    expect(isBrandMotionPreviewEnabled(false, "oriental.mereka.io")).toBe(false);
  });

  it("uses the canonical Mereka mark instead of the generic blue sphere", () => {
    const { container } = render(<MerekaMiniMark size={32} />);
    const mark = container.querySelector('[data-mereka-mark="true"]');

    expect(mark).toHaveAttribute("viewBox", "0 0 427.76 342.13");
    expect(mark?.querySelector(`path[d="${MEREKA_MARK_PATH}"]`)).toBeInTheDocument();
    expect(mark?.querySelector("circle")).toBeInTheDocument();
    expect(mark?.querySelector('circle[cx="18"]')).not.toBeInTheDocument();
  });

  it("keeps the M resolved at rest and only loosens particles for live voice states", () => {
    expect(resolveMerekaMarkTarget({ connectionStatus: "idle", turnPhase: "quiet" })).toBe(1);
    expect(resolveMerekaMarkTarget({ connectionStatus: "listening", turnPhase: "assistant_speaking" })).toBe(1);
    expect(resolveMerekaMarkTarget({ connectionStatus: "listening", turnPhase: "user_speaking" })).toBe(0.25);
    expect(resolveMerekaMarkTarget({ connectionStatus: "connecting", turnPhase: "quiet" })).toBe(0.35);
  });

  it("keeps the static WebGL fallback decorative and unfocusable", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    render(<NebulaM connectionStatus="idle" levelsRef={{ current: { user: 0, voice: 0 } }} turnPhase="quiet" />);

    await waitFor(() => expect(document.querySelector('[data-fallback="true"]')).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /interactive mereka nebula/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-fallback="true"]')).not.toHaveAttribute("tabindex");
  });

  it("shows the public trace once per tab without ever blocking input or scrolling", () => {
    vi.useFakeTimers();
    render(<MerekaSiteLoader buildFlag />);

    expect(screen.getByRole("status")).toHaveAttribute("data-phase", "visible");
    expect(screen.getByRole("status")).toHaveAttribute("data-input-blocking", "false");
    expect(document.documentElement.style.overflow).toBe("");
    expect(window.sessionStorage.getItem(merekaLoaderSessionKey)).toBe("true");
    expect(MEREKA_LOADER_HOLD_MS + MEREKA_LOADER_EXIT_MS).toBeLessThanOrEqual(700);

    act(() => vi.advanceTimersByTime(MEREKA_LOADER_HOLD_MS));
    expect(screen.getByRole("status")).toHaveAttribute("data-phase", "leaving");

    act(() => vi.advanceTimersByTime(MEREKA_LOADER_EXIT_MS));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("skips the entrance on admin, repeat, and reduced-motion loads", () => {
    expect(shouldShowMerekaSiteLoader("/", false, false, true)).toBe(true);
    expect(shouldShowMerekaSiteLoader("/admin/session-review", false, false, true)).toBe(false);
    expect(shouldShowMerekaSiteLoader("/", true, false, true)).toBe(false);
    expect(shouldShowMerekaSiteLoader("/", false, true, true)).toBe(false);
    expect(shouldShowMerekaSiteLoader("/", false, false, false)).toBe(false);
  });

  it("fails open when browser storage allows reads but rejects writes", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "QuotaExceededError");
    });

    render(<MerekaSiteLoader buildFlag />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe("");
    setItem.mockRestore();
  });
});
