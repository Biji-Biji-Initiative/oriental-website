import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/leads/archive/route";
import { archiveAdminLeads } from "@/lib/server/convex";

vi.mock("@/lib/server/convex", () => ({
  archiveAdminLeads: vi.fn(),
}));

const originalEnv = process.env;
const archiveMock = vi.mocked(archiveAdminLeads);

describe("admin lead archive route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_ACTOR: "Nadia",
    };
    archiveMock.mockResolvedValue({ ok: true, count: 2 });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("keeps viewers read-only", async () => {
    process.env = { ...process.env, ADMIN_REVIEW_ROLE: "viewer" };

    const response = await POST(archiveRequest());

    expect(response.status).toBe(403);
    expect(archiveMock).not.toHaveBeenCalled();
  });

  it("applies one revision-checked atomic archive request", async () => {
    const response = await POST(archiveRequest());

    expect(response.status).toBe(200);
    expect(archiveMock).toHaveBeenCalledWith(
      {
        action: "archive",
        leads: [
          { leadId: "lead_1", expectedRevision: 2 },
          { leadId: "lead_2", expectedRevision: 7 },
        ],
        reason: "Duplicate campaign submissions",
      },
      { actor: "Nadia", requestId: expect.any(String) },
    );
    await expect(response.json()).resolves.toEqual({ ok: true, action: "archive", count: 2 });
  });

  it("returns all-or-nothing conflicts without overwriting", async () => {
    archiveMock.mockResolvedValue({ ok: false, reason: "conflict", leadIds: ["lead_2"] });

    const response = await POST(archiveRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "conflict", leadIds: ["lead_2"] });
  });

  it("accepts restore as a reversible action", async () => {
    const response = await POST(archiveRequest("restore"));

    expect(response.status).toBe(200);
    expect(archiveMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "restore" }),
      expect.objectContaining({ actor: "Nadia" }),
    );
  });
});

function archiveRequest(action: "archive" | "restore" = "archive") {
  return new Request("http://localhost/api/admin/leads/archive", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-review-token-123456789",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      leads: [
        { leadId: "lead_1", expectedRevision: 2 },
        { leadId: "lead_2", expectedRevision: 7 },
      ],
      reason: "Duplicate campaign submissions",
    }),
  });
}
