import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/leads/bulk/route";
import { bulkAssignAdminLeads } from "@/lib/server/convex";

vi.mock("@/lib/server/convex", () => ({
  bulkAssignAdminLeads: vi.fn(),
}));

const originalEnv = process.env;
const bulkAssignMock = vi.mocked(bulkAssignAdminLeads);

describe("admin bulk lead assignment route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "operator",
      ADMIN_REVIEW_ACTOR: "Gurpreet",
    };
    bulkAssignMock.mockResolvedValue({ ok: true, count: 2 });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("requires bulk-assignment permission", async () => {
    process.env = { ...process.env, ADMIN_REVIEW_ROLE: "viewer" };

    const response = await POST(bulkRequest());

    expect(response.status).toBe(403);
    expect(bulkAssignMock).not.toHaveBeenCalled();
  });

  it("applies one atomic assignment request", async () => {
    const response = await POST(bulkRequest());

    expect(response.status).toBe(200);
    expect(bulkAssignMock).toHaveBeenCalledWith(
      {
        leads: [
          { leadId: "lead_1", expectedRevision: 0 },
          { leadId: "lead_2", expectedRevision: 3 },
        ],
        owner: "Nadia",
        nextActionAt: expect.any(Number),
        nextActionNote: "Send tailored introductions",
        reason: "Morning intake allocation",
      },
      { actor: "Gurpreet", requestId: expect.any(String) },
    );
    await expect(response.json()).resolves.toEqual({ ok: true, count: 2 });
  });

  it("returns all-or-nothing conflicts to the operator", async () => {
    bulkAssignMock.mockResolvedValue({ ok: false, reason: "conflict", leadIds: ["lead_2"] });

    const response = await POST(bulkRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "conflict", leadIds: ["lead_2"] });
  });
});

function bulkRequest() {
  return new Request("http://localhost/api/admin/leads/bulk", {
    method: "POST",
    headers: {
      authorization: "Bearer admin-review-token-123456789",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leads: [
        { leadId: "lead_1", expectedRevision: 0 },
        { leadId: "lead_2", expectedRevision: 3 },
      ],
      owner: "Nadia",
      nextActionAt: Date.now() + 60 * 60 * 1000,
      nextActionNote: "Send tailored introductions",
      reason: "Morning intake allocation",
    }),
  });
}
