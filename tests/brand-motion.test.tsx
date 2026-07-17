import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MerekaSiteLoader } from "@/components/brand-motion/MerekaSiteLoader";
import { NebulaM, resolveMerekaMarkTarget } from "@/components/brand-motion/NebulaM";
import { MerekaMiniMark } from "@/components/orb/MerekaMiniMark";
import { MEREKA_MARK_PATH, MEREKA_NEBULA_PARTICLE_COUNT, MEREKA_TRACE_DURATION_MS } from "@/lib/brand-motion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.documentElement.style.overflow = "";
});

describe("Mereka brand motion", () => {
  it("keeps the measured motion contract", () => {
    expect(MEREKA_NEBULA_PARTICLE_COUNT).toBe(2_100);
    expect(MEREKA_TRACE_DURATION_MS).toBe(2_600);
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

  it("shows the trace entrance briefly and restores document scrolling", () => {
    vi.useFakeTimers();
    render(<MerekaSiteLoader />);

    expect(screen.getByRole("status")).toHaveAttribute("data-phase", "visible");
    expect(document.documentElement.style.overflow).toBe("hidden");

    act(() => vi.advanceTimersByTime(1_150));
    expect(screen.getByRole("status")).toHaveAttribute("data-phase", "leaving");

    act(() => vi.advanceTimersByTime(520));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe("");
  });
});
