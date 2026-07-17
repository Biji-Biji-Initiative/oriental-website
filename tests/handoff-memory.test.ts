import { beforeEach, describe, expect, it } from "vitest";
import { forgetHandoff, recallHandoff, rememberHandoff } from "@/lib/voice/handoff-memory";

const STORAGE_KEY = "oriental.last-handoff.v1";

// This jsdom setup ships without localStorage; the module only needs the
// storage contract, so a Map-backed stub keeps the tests hermetic.
function installLocalStorageStub() {
  const store = new Map<string, string>();
  const stub: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: stub });
}

describe("handoff memory", () => {
  beforeEach(() => {
    installLocalStorageStub();
  });

  it("round-trips identity fields and segment, never the brief", () => {
    rememberHandoff({ name: "  Aisyah Rahman ", email: "aisyah@khazanah.com.my", org: "Khazanah" }, "technology");
    const recalled = recallHandoff();
    expect(recalled).toMatchObject({
      name: "Aisyah Rahman",
      email: "aisyah@khazanah.com.my",
      org: "Khazanah",
      segment: "technology",
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).not.toHaveProperty("message");
  });

  it("returns null for malformed or missing entries", () => {
    expect(recallHandoff()).toBeNull();
    window.localStorage.setItem(STORAGE_KEY, "not-json{");
    expect(recallHandoff()).toBeNull();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: 42, savedAt: "yes" }));
    expect(recallHandoff()).toBeNull();
  });

  it("forgets a previously submitted identity on clear-all", () => {
    rememberHandoff({ name: "Aisyah", email: "aisyah@example.com", org: "Mereka" }, "other");
    forgetHandoff();
    expect(recallHandoff()).toBeNull();
  });

  it("expires entries older than six months and coerces unknown segments", () => {
    const stale = {
      name: "A",
      email: "a@b.co",
      org: "B",
      segment: "technology",
      savedAt: Date.now() - 200 * 24 * 60 * 60 * 1000,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    expect(recallHandoff()).toBeNull();

    const odd = { name: "A", email: "a@b.co", org: "B", segment: "made-up-segment", savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(odd));
    expect(recallHandoff()?.segment).toBe("other");
  });
});
