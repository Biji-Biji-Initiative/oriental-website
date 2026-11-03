import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/retention/route";
import { applyDataRetention } from "@/lib/server/convex";

vi.mock("@/lib/server/convex", () => ({ applyDataRetention: vi.fn() }));

const originalEnv = process.env;
const retentionMock = vi.mocked(applyDataRetention);

describe("admin retention route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "operator",
      OPS_AUTOMATION_TOKEN: "ops-automation-token-123456789",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("runs the fixed retention policy and returns aggregate deletion counts", async () => {
    retentionMock.mockResolvedValue({
      ok: true,
      deleted: { applicationLogs: 12, archivedLeads: 2, leadEvents: 4, voiceSessions: 8 },
      redacted: { leadTranscripts: 3 },
      hasMore: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      deleted: { applicationLogs: 12, archivedLeads: 2, leadEvents: 4, voiceSessions: 8 },
      redacted: { leadTranscripts: 3 },
      hasMore: true,
    });
    expect(retentionMock).toHaveBeenCalledWith(expect.any(Number));
  });

  it("rejects interactive review credentials and missing authentication", async () => {
    expect((await POST(request("admin-review-token-123456789"))).status).toBe(403);
    expect((await POST(new Request("http://localhost/api/admin/retention", { method: "POST" }))).status).toBe(401);
    expect(retentionMock).not.toHaveBeenCalled();
  });
});

function request(token = "ops-automation-token-123456789") {
  return new Request("http://localhost/api/admin/retention", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}
