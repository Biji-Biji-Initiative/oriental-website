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
      ADMIN_REVIEW_ROLE: "operator",
    };
    updateWorkflowMock.mockResolvedValue({ ok: true, changed: true, revision: 1 });
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
    expect(updateWorkflowMock).toHaveBeenCalledWith(
      "lead_123",
      {
        status: "reviewing",
        priority: "high",
        owner: "Gurpreet",
        note: "Call back after site walk.",
        nextActionAt: expect.any(Number),
        nextActionNote: "Confirm the participant brief.",
        outcomeReason: "",
        expectedRevision: 0,
        reason: "Assigned during intake review.",
      },
      { actor: "Oriental admin", requestId: expect.any(String) },
    );
  });

  it("forbids workflow changes for read-only reviewers", async () => {
    process.env = { ...process.env, ADMIN_REVIEW_ROLE: "viewer" };

    const response = await PATCH(workflowRequest({}), { params: Promise.resolve({ leadId: "lead_123" }) });

    expect(response.status).toBe(403);
    expect(updateWorkflowMock).not.toHaveBeenCalled();
  });

  it("rejects active-to-archived transitions before calling the workflow mutation", async () => {
    const response = await PATCH(workflowRequest({ status: "archived" }), {
      params: Promise.resolve({ leadId: "lead_123" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid_payload" });
    expect(updateWorkflowMock).not.toHaveBeenCalled();
  });

  it("rejects archived-to-active transitions at the atomic data boundary", async () => {
    updateWorkflowMock.mockResolvedValue({ ok: false, reason: "archive_boundary" });

    const response = await PATCH(workflowRequest({ status: "reviewing" }), {
      params: Promise.resolve({ leadId: "archived_lead" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "archive_boundary" });
  });

  it("returns a conflict instead of overwriting a newer revision", async () => {
    updateWorkflowMock.mockResolvedValue({ ok: false, reason: "conflict", currentRevision: 4 });

    const response = await PATCH(workflowRequest({}), { params: Promise.resolve({ leadId: "lead_123" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "conflict",
      currentRevision: 4,
    });
  });

  it("maps missing leads to 404", async () => {
    updateWorkflowMock.mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await PATCH(workflowRequest({}), { params: Promise.resolve({ leadId: "missing" }) });

    expect(response.status).toBe(404);
  });
});

function workflowRequest({
  status = "reviewing",
  token = "admin-review-token-123456789",
}: {
  status?: string;
  token?: string | null;
}) {
  return new Request("http://localhost/api/admin/leads/lead_123", {
    method: "PATCH",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status,
      priority: "high",
      owner: "Gurpreet",
      note: "Call back after site walk.",
      nextActionAt: Date.now() + 60 * 60 * 1000,
      nextActionNote: "Confirm the participant brief.",
      outcomeReason: "",
      expectedRevision: 0,
      reason: "Assigned during intake review.",
    }),
  });
}
