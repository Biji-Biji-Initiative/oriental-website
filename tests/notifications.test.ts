import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildOwnerNotification, buildSlackPayload } from "@/lib/server/notification-payloads";
import { notifySlack, type StoredLead } from "@/lib/server/notifications";

const originalEnv = process.env;

function lead(overrides: Partial<StoredLead> = {}): StoredLead {
  return {
    id: "lead_123",
    source: "voice",
    segment: "ai",
    form: {
      name: "Alex Tan",
      email: "alex@example.com",
      org: "CogWorks <script>",
      message: "We want to run AI literacy demos.\nAlso exploring agent labs.",
    },
    transcript: [
      { role: "assistant", text: "What brought you here today?" },
      { role: "user", text: "We want to explore an AI lab." },
      { role: "assistant", text: "I'll capture that." },
    ],
    turnstileToken: "local-dev",
    utm: {},
    routedTo: "Gurpreet",
    routedToEmail: "gurpreet@example.com",
    ...overrides,
  };
}

describe("notification payload builders", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("builds owner email copy with routing metadata and transcript context", () => {
    const notification = buildOwnerNotification(lead());

    expect(notification.subject).toBe("[Oriental] AI lead from CogWorks <script>");
    expect(notification.text).toContain("Lead ID: lead_123");
    expect(notification.text).toContain("Source: Voice workspace");
    expect(notification.text).toContain("Segment: AI (ai)");
    expect(notification.text).toContain("Routed to: Gurpreet");
    expect(notification.text).toContain("Mereka: What brought you here today?");
    expect(notification.text).toContain("Reply directly to alex@example.com");
  });

  it("escapes owner email HTML while preserving readable line breaks", () => {
    const notification = buildOwnerNotification(lead());

    expect(notification.html).toContain("CogWorks &lt;script&gt;");
    expect(notification.html).not.toContain("CogWorks <script>");
    expect(notification.html).toContain("AI literacy demos.<br />Also exploring agent labs.");
    expect(notification.html).toContain("mailto:alex%40example.com");
  });

  it("builds a Slack payload with reviewable fields and escaped mrkdwn", () => {
    const payload = buildSlackPayload(lead());
    const body = JSON.stringify(payload);

    expect(payload.text).toBe("New Oriental lead for Gurpreet: Alex Tan from CogWorks <script>");
    expect(payload.blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Oriental lead: AI" },
    });
    expect(body).toContain("*Lead ID*\\nlead_123");
    expect(body).toContain("*Source*\\nVoice workspace");
    expect(body).toContain("CogWorks &lt;script&gt;");
    expect(body).toContain("*Conversation context*");
  });
});

describe("notifySlack", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SLACK_WEBHOOK_URL: "https://hooks.slack.test/oriental",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("posts the structured Slack payload", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifySlack(lead());

    expect(result).toEqual({ ok: true, transport: "slack" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.test/oriental",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    const payload = JSON.parse(String(init?.body));
    expect(payload.blocks).toHaveLength(4);
    expect(JSON.stringify(payload)).toContain("*Brief*");
  });

  it("uses Slack Web API channel routing when a bot token and channel are configured", async () => {
    process.env = {
      ...process.env,
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_CHANNEL_ID: "C01AVSGACFN",
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ok: true, channel: "C01AVSGACFN", ts: "123.456" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifySlack(lead());

    expect(result).toEqual({ ok: true, transport: "slack" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer xoxb-test",
          "Content-Type": "application/json; charset=utf-8",
        },
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body));
    expect(payload.channel).toBe("C01AVSGACFN");
    expect(payload.blocks).toHaveLength(4);
  });

  it("returns Slack HTTP status failures without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 500 })),
    );

    await expect(notifySlack(lead())).resolves.toEqual({
      ok: false,
      error: "slack_http_error",
      status: 500,
    });
  });

  it("returns Slack Web API failures without falling back to webhook", async () => {
    process.env = {
      ...process.env,
      SLACK_BOT_TOKEN: "xoxb-test",
      SLACK_CHANNEL_ID: "C01AVSGACFN",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error: "channel_not_found" })),
    );

    await expect(notifySlack(lead())).resolves.toEqual({
      ok: false,
      error: "channel_not_found",
      status: 200,
    });
  });
});
