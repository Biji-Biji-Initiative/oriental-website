import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAddressablePrivacyCopies,
  type PrivacyDeletionPlan,
  privacyManualCleanupCounts,
} from "@/lib/server/privacy-downstream";

const originalEnv = process.env;

describe("privacy downstream cleanup", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SLACK_BOT_TOKEN: "xoxb-test",
      CLICKUP_API_TOKEN: "clickup-test",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("requires manual confirmation for delivered email and unaddressable legacy mirrors", () => {
    expect(
      privacyManualCleanupCounts({
        leads: [
          {
            notificationEmailOk: true,
            notificationConfirmationOk: true,
            notificationSlackOk: true,
            notificationClickUpOk: true,
          },
        ],
      }),
    ).toEqual({ ownerEmail: 1, submitterEmail: 1, unaddressableSlack: 1, unaddressableClickUp: 1 });
  });

  it("deletes addressable Slack and ClickUp copies before Convex erasure", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("slack.com")) return Response.json({ ok: true });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAddressablePrivacyCopies(plan())).resolves.toEqual({
      ok: true,
      failures: { slack: 0, clickup: 0 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.delete",
      expect.objectContaining({
        body: JSON.stringify({ channel: "C0123", ts: "1717.0001" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clickup.com/api/v2/task/task_123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("treats already-deleted external copies as idempotent success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("slack.com")
          ? Response.json({ ok: false, error: "message_not_found" })
          : new Response(null, { status: 404 }),
      ),
    );

    await expect(deleteAddressablePrivacyCopies(plan())).resolves.toMatchObject({ ok: true });
  });
});

function plan(): PrivacyDeletionPlan {
  return {
    leads: [
      {
        notificationEmailOk: false,
        notificationConfirmationOk: false,
        notificationSlackOk: true,
        notificationSlackMessageId: "C0123:1717.0001",
        notificationClickUpOk: true,
        notificationClickUpTaskId: "task_123",
      },
    ],
  };
}
