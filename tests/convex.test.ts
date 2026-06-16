import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistLead, updateAdminLeadWorkflow } from "@/lib/server/convex";
import type { StoredLead } from "@/lib/server/notifications";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mocks.mutation;

    constructor(url: string) {
      mocks.client(url);
    }
  },
}));

vi.mock("@/convex/_generated/api", () => ({
  api: { leads: { createLead: "createLead", updateLeadWorkflow: "updateLeadWorkflow" } },
}));

const originalEnv = process.env;

function lead(): StoredLead {
  return {
    id: "lead_123",
    source: "voice",
    segment: "technology",
    routedTo: "Gurpreet",
    routedToEmail: "gurpreet@example.com",
    form: {
      name: "Asha",
      email: "asha@example.com",
      org: "Future Lab",
      phone: "",
      website: "",
      message: "We want to run public AI literacy demos.",
    },
    transcript: [],
    turnstileToken: "local-dev",
    utm: {},
  };
}

describe("persistLead", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CONVEX_URL: "'https://convex.example'",
      CONVEX_INGEST_SECRET: "'ingest-secret'",
    };
    mocks.mutation.mockResolvedValue({ id: "lead_123" });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("sanitizes quoted Infisical values before creating the Convex client", async () => {
    await expect(persistLead(lead())).resolves.toEqual({ id: "lead_123", persisted: true });

    expect(mocks.client).toHaveBeenCalledWith("https://convex.example");
    expect(mocks.mutation).toHaveBeenCalledWith("createLead", {
      lead: expect.objectContaining({ id: "lead_123" }),
      ingestSecret: "ingest-secret",
    });
  });

  it("applies admin workflow mutations through Convex", async () => {
    mocks.mutation.mockResolvedValue({ ok: true });

    await expect(
      updateAdminLeadWorkflow("lead_123", {
        status: "qualified",
        priority: "urgent",
        owner: "Gurpreet",
        note: "Ready for direct follow-up.",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.mutation).toHaveBeenCalledWith("updateLeadWorkflow", {
      ingestSecret: "ingest-secret",
      leadId: "lead_123",
      status: "qualified",
      priority: "urgent",
      owner: "Gurpreet",
      note: "Ready for direct follow-up.",
    });
  });
});
