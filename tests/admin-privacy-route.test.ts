import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/admin/privacy/route";
import { deletePersonalData, getPrivacyDeletionPlan } from "@/lib/server/convex";

vi.mock("@/lib/server/convex", () => ({
  deletePersonalData: vi.fn(),
  getPrivacyDeletionPlan: vi.fn(),
}));

const originalEnv = process.env;
const deleteMock = vi.mocked(deletePersonalData);
const planMock = vi.mocked(getPrivacyDeletionPlan);
const body = {
  email: " Visitor@Example.com ",
  confirmation: "DELETE",
  reason: "data_subject_request",
  requestId: "78584c0d-406a-41b5-ae9f-f2eb23650a0a",
} as const;

describe("admin privacy deletion route", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      ADMIN_REVIEW_TOKEN: "admin-review-token-123456789",
      ADMIN_REVIEW_ROLE: "admin",
      PRIVACY_ADMIN_TOKEN: "privacy-admin-token-123456789",
    };
    planMock.mockResolvedValue({ ok: true, leads: [], complete: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("normalizes the subject and returns counts without echoing personal data", async () => {
    deleteMock.mockResolvedValue({
      ok: true,
      deleted: { leads: 1, leadEvents: 3, voiceSessions: 2 },
      complete: true,
    });

    const response = await DELETE(request(body));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toEqual({
      ok: true,
      deleted: { leads: 1, leadEvents: 3, voiceSessions: 2 },
      complete: true,
    });
    expect(JSON.stringify(result)).not.toContain("example.com");
    expect(deleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "visitor@example.com",
        reason: "data_subject_request",
        requestId: body.requestId,
        actor: "Oriental privacy administrator",
        downstreamCleanupComplete: true,
      }),
    );
  });

  it("waits for bounded legacy normalization before deleting anything", async () => {
    planMock.mockResolvedValue({ ok: true, leads: [], complete: false });

    const response = await DELETE(request(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "normalization_in_progress",
      retryable: true,
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns a retryable non-success when bounded erasure has more matching rows", async () => {
    deleteMock.mockResolvedValue({
      ok: true,
      deleted: { leads: 2, leadEvents: 8, voiceSessions: 24 },
      complete: false,
    });

    const response = await DELETE(request(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "deletion_incomplete",
      retryable: true,
      deleted: { leads: 2, leadEvents: 8, voiceSessions: 24 },
      complete: false,
    });
  });

  it("requires explicit confirmation that unaddressable copies were deleted", async () => {
    planMock.mockResolvedValue({
      ok: true,
      complete: true,
      leads: [
        {
          leadId: "lead_1",
          notificationEmailOk: true,
          notificationConfirmationOk: true,
          notificationSlackOk: true,
          notificationClickUpOk: false,
        },
      ],
    });

    const response = await DELETE(request(body));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "manual_cleanup_required",
      manualCleanup: {
        ownerEmail: 1,
        submitterEmail: 1,
        unaddressableSlack: 1,
        unaddressableClickUp: 0,
      },
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("requires an explicit destructive confirmation and the dedicated bearer", async () => {
    expect((await DELETE(request({ ...body, confirmation: "NO" }))).status).toBe(400);

    expect((await DELETE(request(body, "admin-review-token-123456789"))).status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

function request(value: unknown, token = "privacy-admin-token-123456789") {
  return new Request("http://localhost/api/admin/privacy", {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
}
