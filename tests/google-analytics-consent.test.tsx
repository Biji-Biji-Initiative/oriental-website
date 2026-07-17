import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/faq" }));
vi.mock("next/script", () => ({
  default: ({ children, id, src }: { children?: string; id?: string; src?: string }) => (
    <script data-testid={src ? "ga-external" : "ga-inline"} id={id} src={src}>
      {children}
    </script>
  ),
}));

describe("GA4 consent boundary", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC123DEF4";
    window.localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  });

  it("does not request GA until the visitor explicitly allows analytics", async () => {
    const { GoogleAnalytics } = await import("@/components/site/GoogleAnalytics");
    render(<GoogleAnalytics />);

    expect(await screen.findByLabelText("Analytics privacy choices")).toBeInTheDocument();
    expect(screen.queryByTestId("ga-external")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Allow analytics" }));

    await waitFor(() => expect(screen.getByTestId("ga-external")).toBeInTheDocument());
    expect(screen.getByTestId("ga-external")).toHaveAttribute(
      "src",
      "https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4",
    );
  });

  it("keeps GA absent after the visitor chooses only necessary storage", async () => {
    const { GoogleAnalytics, analyticsConsentStorageKey } = await import("@/components/site/GoogleAnalytics");
    render(<GoogleAnalytics />);

    fireEvent.click(await screen.findByRole("button", { name: "Only necessary" }));

    await waitFor(() => expect(screen.queryByLabelText("Analytics privacy choices")).not.toBeInTheDocument());
    expect(window.localStorage.getItem(analyticsConsentStorageKey)).toBe("denied");
    expect(screen.queryByTestId("ga-external")).not.toBeInTheDocument();
  });
});
