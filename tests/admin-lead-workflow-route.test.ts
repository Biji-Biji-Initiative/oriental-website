import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/admin/leads/[leadId]/route";
import { updateAdminLeadWorkflow } from "@/lib/server/convex";

vi.mock("@/lib/server/convex", () => ({
  updateAdminLeadWorkflow: vi.fn(),
}));

const originalEnv = process.env;
const updateWorkflowMock = vi.mocked(updateAdminLeadWorkflow);

describe("admin lead workflow route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
    };
    updateWorkflowMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("requires admin auth", async () => {
    const response = await PATCH(workflowRequest({ token: null }), { params: Promise.resolve({ leadId: "lead_123" }) });

    expect(response.status).toBe(401);
    expect(updateWorkflowMock).not.toHaveBeenCalled();
  });

  it("validates and applies workflow updates", async () => {
    const response = await PATCH(workflowRequest({}), { params: Promise.resolve({ leadId: "lead_123" }) });

    expect(response.status).toBe(200);
    expect(updateWorkflowMock).toHaveBeenCalledWith("lead_123", {
      status: "reviewing",
      priority: "high",
      owner: "Gurpreet",
      note: "Call back after site walk.",
    });
  });

  it("maps missing leads to 404", async () => {
    updateWorkflowMock.mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await PATCH(workflowRequest({}), { params: Promise.resolve({ leadId: "missing" }) });

    expect(response.status).toBe(404);
  });
});

function workflowRequest({ token = "admin-review-token-123456789" }: { token?: string | null }) {
  return new Request("http://localhost/api/admin/leads/lead_123", {
    method: "PATCH",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "reviewing",
      priority: "high",
      owner: "Gurpreet",
      note: "Call back after site walk.",
    }),
  });
}
