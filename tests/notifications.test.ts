import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNewsletterConfirmation,
  buildOwnerNotification,
  buildSlackPayload,
  buildSubmitterConfirmation,
} from "@/lib/server/notification-payloads";
import {
  notifyClickUp,
  notifyNewsletterSubscriber,
  notifyOwner,
  notifySlack,
  notifySubmitter,
  type StoredLead,
} from "@/lib/server/notifications";
import { sendSmtpMail } from "@/lib/server/smtp";

vi.mock("@/lib/server/smtp", () => ({ sendSmtpMail: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    send = vi.fn(async () => ({}));
  },
  SendEmailCommand: class {},
}));

const originalEnv = process.env;

function lead(overrides: Partial<StoredLead> = {}): StoredLead {
  return {
    id: "lead_123",
    source: "voice",
    segment: "technology",
    form: {
      name: "Alex Tan",
      email: "alex@example.com",
      org: "CogWorks <script>",
      phone: "",
      website: "",
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

    expect(notification.subject).toBe("[Oriental] Technology lead from CogWorks <script>");
    expect(notification.text).toContain("Lead ID: lead_123");
    expect(notification.text).toContain("Source: Voice workspace");
    expect(notification.text).toContain("Segment: Technology (technology)");
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
      text: { type: "plain_text", text: "New Oriental lead · Technology" },
    });
    expect(body).toContain("<mailto:alex@example.com|alex@example.com>");
    expect(body).toContain("Technology · Voice workspace · Lead lead_123");
    expect(body).toContain("CogWorks &lt;script&gt;");
    expect(body).toContain("*Conversation context*");
    expect(payload.blocks.at(-1)).toMatchObject({ type: "context" });
  });

  it("builds submitter confirmation copy", () => {
    const notification = buildSubmitterConfirmation(lead(), "team@mereka.io");

    expect(notification.subject).toBe("We received your Oriental Building note");
    expect(notification.text).toContain("Hi Alex Tan");
    expect(notification.text).toContain("the Mereka team has a copy");
    expect(notification.text).toContain("Technology");
    expect(notification.html).toContain("team@mereka.io");
    expect(notification.html).toContain("AI literacy demos.<br />Also exploring agent labs.");
  });

  it("builds newsletter confirmation copy without lead handoff language", () => {
    const notification = buildNewsletterConfirmation("asha@example.com", "team@mereka.io");

    expect(notification.subject).toBe("You're on the Oriental Building updates list");
    expect(notification.text).toContain("Thanks for signing up for Oriental Building updates");
    expect(notification.text).not.toContain("handoff");
    expect(notification.text).toContain("Subscribed email: asha@example.com");
    expect(notification.html).toContain("team@mereka.io");
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
    expect(payload.blocks).toHaveLength(6);
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
    expect(payload.blocks).toHaveLength(6);
  });

  it("retries a transient Slack failure once before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(notifySlack(lead())).resolves.toEqual({ ok: true, transport: "slack" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const fetchMock = vi.fn(async () => Response.json({ ok: false, error: "channel_not_found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(notifySlack(lead())).resolves.toEqual({
      ok: false,
      error: "channel_not_found",
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("notifyOwner", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      SES_FROM_ADDRESS: "oriental@mereka.test",
      SMTP_USER: "smtp-user",
      SMTP_PASSWORD: "smtp-password",
      SMTP_HOST: "email-smtp.test.amazonaws.com",
      AWS_REGION: "ap-southeast-1",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not retry or fall back after an SMTP transaction failure", async () => {
    vi.mocked(sendSmtpMail).mockRejectedValue(new Error("smtp_down"));

    await expect(notifyOwner(lead())).resolves.toEqual({ ok: false, error: "smtp_down", status: 400 });
    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
  });

  it("uses SESv2 when SMTP is not configured", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_HOST;

    await expect(notifyOwner(lead())).resolves.toEqual({ ok: true, transport: "sesv2" });
  });

  it("delivers through SMTP when it is healthy", async () => {
    vi.mocked(sendSmtpMail).mockResolvedValue(undefined);

    await expect(notifyOwner(lead())).resolves.toEqual({ ok: true, transport: "smtp" });
    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
    expect(sendSmtpMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["gurpreet@example.com"] }));
  });

  it("adds an explicit configured team inbox to the SMTP recipient batch", async () => {
    process.env.TEAM_NOTIFICATION_EMAIL = "team@mereka.io";
    vi.mocked(sendSmtpMail).mockResolvedValue(undefined);

    await expect(notifyOwner(lead())).resolves.toEqual({ ok: true, transport: "smtp" });
    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
    expect(sendSmtpMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["gurpreet@example.com", "team@mereka.io"] }),
    );
  });

  it("accepts comma-separated team copy recipients and deduplicates them", async () => {
    process.env.TEAM_NOTIFICATION_EMAIL = "team@mereka.io";
    process.env.TEAM_NOTIFICATION_CC_EMAILS = " chewi@mereka.my, TEAM@mereka.io ; partners@mereka.io ";
    vi.mocked(sendSmtpMail).mockResolvedValue(undefined);

    await expect(notifyOwner(lead({ routedToEmail: "gurpreet@example.com" }))).resolves.toEqual({
      ok: true,
      transport: "smtp",
    });
    expect(sendSmtpMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["gurpreet@example.com", "team@mereka.io", "chewi@mereka.my", "partners@mereka.io"],
      }),
    );
  });

  it("deduplicates the team copy when the routed owner is the configured team inbox", async () => {
    process.env.TEAM_NOTIFICATION_EMAIL = "team@mereka.io";
    vi.mocked(sendSmtpMail).mockResolvedValue(undefined);

    await expect(notifyOwner(lead({ routedToEmail: "team@mereka.io" }))).resolves.toEqual({
      ok: true,
      transport: "smtp",
    });
    expect(sendSmtpMail).toHaveBeenCalledTimes(1);
    expect(sendSmtpMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["team@mereka.io"] }));
  });

  it("sends a confirmation email to the submitter", async () => {
    process.env.SES_REPLY_TO = "team@mereka.io";
    vi.mocked(sendSmtpMail).mockResolvedValue(undefined);

    await expect(notifySubmitter(lead())).resolves.toEqual({ ok: true, transport: "smtp" });
    expect(sendSmtpMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["alex@example.com"],
        replyTo: "team@mereka.io",
        subject: "We received your Oriental Building note",
      }),
    );
  });

  it("sends a newsletter confirmation email to the subscriber", async () => {
    process.env.SES_REPLY_TO = "team@mereka.io";
    vi.mocked(sendSmtpMail).mockResolvedValue(undefined);

    await expect(notifyNewsletterSubscriber("asha@example.com")).resolves.toEqual({ ok: true, transport: "smtp" });
    expect(sendSmtpMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["asha@example.com"],
        replyTo: "team@mereka.io",
        subject: "You're on the Oriental Building updates list",
      }),
    );
  });
});

describe("notifyClickUp", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      CLICKUP_API_TOKEN: "clickup-token",
      CLICKUP_LIST_URL: "https://app.clickup.com/2627356/v/li/901615726504",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("creates a ClickUp task in the configured list", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ id: "task_123", url: "https://app.clickup.com/t/task_123" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(notifyClickUp(lead())).resolves.toEqual({ ok: true, transport: "clickup" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.clickup.com/api/v2/list/901615726504/task",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "clickup-token",
          "Content-Type": "application/json",
        },
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(String(init?.body));
    expect(payload.name).toBe("Oriental lead: Alex Tan · Technology · lead_123");
    expect(payload.markdown_content).toContain("**Lead ID:** lead_123");
    expect(payload.markdown_content).toContain("### Voice transcript");
    expect(payload.tags).toEqual(["oriental", "voice", "technology"]);
  });

  it("skips cleanly when ClickUp is not configured", async () => {
    delete process.env.CLICKUP_API_TOKEN;
    delete process.env.CLICKUP_API_KEY;

    await expect(notifyClickUp(lead())).resolves.toEqual({
      ok: false,
      skipped: true,
      reason: "clickup_unconfigured",
    });
  });

  it("returns ClickUp API failures without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ err: "list_not_found" }, { status: 404 })),
    );

    await expect(notifyClickUp(lead())).resolves.toEqual({
      ok: false,
      error: "list_not_found",
      status: 404,
    });
  });
});
