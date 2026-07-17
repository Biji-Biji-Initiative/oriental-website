import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { readEnv } from "@/lib/env";
import type { LeadRequest } from "@/lib/schemas";
import { getOwnerEmail, getSegment } from "@/lib/segments";
import { errorMeta, logWarn } from "@/lib/server/logger";
import {
  buildNewsletterConfirmation,
  buildOwnerNotification,
  buildSlackPayload,
  buildSubmitterConfirmation,
} from "@/lib/server/notification-payloads";
import { sendSmtpMail } from "@/lib/server/smtp";

type RoutableLead = Omit<LeadRequest, "source" | "voiceReviewToken"> & {
  source: LeadRequest["source"] | "hero-email";
};

export type StoredLead = RoutableLead & {
  id: string;
  routedTo: string;
  routedToEmail: string | null;
};

export type NotificationResult =
  | {
      ok: true;
      transport: "smtp" | "sesv2" | "slack" | "clickup";
      externalId?: string;
      externalUrl?: string;
    }
  | { ok: false; skipped?: true; reason?: string; error?: string; status?: number };

const TRANSIENT_RETRY_DELAY_MS = 400;

export async function notifyOwner(lead: StoredLead): Promise<NotificationResult> {
  return withTransientRetry(() => sendOwnerEmail(lead));
}

export async function notifySlack(lead: StoredLead): Promise<NotificationResult> {
  return withTransientRetry(() => sendSlackMessage(lead));
}

export async function notifyClickUp(lead: StoredLead): Promise<NotificationResult> {
  return withTransientRetry(() => sendClickUpTask(lead));
}

export async function notifySubmitter(lead: StoredLead): Promise<NotificationResult> {
  return withTransientRetry(() => sendSubmitterConfirmation(lead));
}

export async function notifyNewsletterSubscriber(email: string): Promise<NotificationResult> {
  return withTransientRetry(() => sendNewsletterConfirmation(email));
}

async function withTransientRetry(send: () => Promise<NotificationResult>): Promise<NotificationResult> {
  const first = await attemptNotification(send);
  if (!isTransientFailure(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
  return attemptNotification(send);
}

async function attemptNotification(send: () => Promise<NotificationResult>): Promise<NotificationResult> {
  try {
    return await send();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isTransientFailure(result: NotificationResult): boolean {
  if (result.ok || result.skipped) return false;
  return result.status === undefined || result.status === 429 || result.status >= 500;
}

async function sendOwnerEmail(lead: StoredLead): Promise<NotificationResult> {
  const notification = buildOwnerNotification(lead);
  const recipients = uniqueEmails([lead.routedToEmail, ...teamNotificationEmails()]);
  if (recipients.length === 0) {
    return { ok: false, skipped: true, reason: "email_unconfigured" };
  }

  return sendConfiguredEmail({
    to: recipients,
    replyTo: lead.form.email,
    subject: notification.subject,
    text: notification.text,
    html: notification.html,
    leadId: lead.id,
  });
}

async function sendSubmitterConfirmation(lead: StoredLead): Promise<NotificationResult> {
  const contactEmail = contactEmailAddress();
  const notification = buildSubmitterConfirmation(lead, contactEmail);
  return sendConfiguredEmail({
    to: [lead.form.email],
    replyTo: contactEmail,
    subject: notification.subject,
    text: notification.text,
    html: notification.html,
    leadId: lead.id,
  });
}

async function sendNewsletterConfirmation(email: string): Promise<NotificationResult> {
  const contactEmail = contactEmailAddress();
  const notification = buildNewsletterConfirmation(email, contactEmail);
  return sendConfiguredEmail({
    to: [email],
    replyTo: contactEmail,
    subject: notification.subject,
    text: notification.text,
    html: notification.html,
    leadId: `newsletter:${email}`,
  });
}

type EmailMessage = {
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  leadId: string;
};

async function sendConfiguredEmail(message: EmailMessage): Promise<NotificationResult> {
  const from = readEnv("SES_FROM_ADDRESS") ?? readEnv("SES_FROM_EMAIL");
  if (!from) return { ok: false, skipped: true, reason: "email_unconfigured" };

  const smtpUser = readEnv("SMTP_USER") ?? readEnv("EMAIL_SERVER_USER");
  const smtpPassword = readEnv("SMTP_PASSWORD") ?? readEnv("EMAIL_SERVER_PASSWORD");
  const awsRegion = readEnv("AWS_REGION");
  const smtpHost = readEnv("SMTP_HOST") ?? (awsRegion ? `email-smtp.${awsRegion}.amazonaws.com` : undefined);
  const smtpPort = Number(readEnv("SMTP_PORT", "587"));
  if (smtpUser && smtpPassword && smtpHost) {
    try {
      await sendSmtpMail({
        host: smtpHost,
        port: smtpPort,
        username: smtpUser,
        password: smtpPassword,
        from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { ok: true, transport: "smtp" };
    } catch (error) {
      logWarn("notification.smtp_failed", { leadId: message.leadId, error: errorMeta(error) });
      return { ok: false, error: error instanceof Error ? error.message : String(error), status: 400 };
    }
  }

  if (!awsRegion) return { ok: false, skipped: true, reason: "ses_unconfigured" };

  const client = new SESv2Client({ region: awsRegion });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: message.to },
      ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: message.subject },
          Body: {
            Text: {
              Data: message.text,
            },
            Html: {
              Data: message.html,
            },
          },
        },
      },
    }),
  );
  return { ok: true, transport: "sesv2" };
}

function teamNotificationEmails() {
  return uniqueEmails([
    ...emailsFromEnv("TEAM_NOTIFICATION_EMAIL"),
    ...emailsFromEnv("TEAM_NOTIFICATION_EMAILS"),
    ...emailsFromEnv("TEAM_NOTIFICATION_CC_EMAILS"),
    ...emailsFromEnv("TEAM_INBOX_EMAIL"),
  ]);
}

function contactEmailAddress() {
  return readEnv("SES_REPLY_TO") ?? teamNotificationEmails()[0];
}

function emailsFromEnv(name: string) {
  const value = readEnv(name);
  if (!value) return [];
  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function uniqueEmails(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const value of values) {
    const email = value?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails;
}

async function sendSlackMessage(lead: StoredLead): Promise<NotificationResult> {
  const payload = buildSlackPayload(lead);
  const slackBotToken = readEnv("SLACK_BOT_TOKEN");
  const slackChannel = readEnv("SLACK_CHANNEL_ID") ?? readEnv("SLACK_CHANNEL");
  if (slackBotToken && slackChannel) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${slackBotToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: slackChannel, text: payload.text, blocks: payload.blocks }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || body?.ok !== true) {
      return { ok: false, error: body?.error ?? "slack_api_error", status: response.status };
    }
    return { ok: true, transport: "slack" };
  }

  const slackWebhookUrl = readEnv("SLACK_WEBHOOK_URL");
  if (!slackWebhookUrl) {
    return { ok: false, skipped: true, reason: "slack_unconfigured" };
  }

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return { ok: false, error: "slack_http_error", status: response.status };
  }
  return { ok: true, transport: "slack" };
}

async function sendClickUpTask(lead: StoredLead): Promise<NotificationResult> {
  const clickUpToken = readEnv("CLICKUP_API_TOKEN") ?? readEnv("CLICKUP_API_KEY");
  const listId = clickUpListId();
  if (!clickUpToken || !listId) return { ok: false, skipped: true, reason: "clickup_unconfigured" };

  const segment = getSegment(lead.segment);
  const response = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task`, {
    method: "POST",
    headers: {
      Authorization: clickUpToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Mereka at Oriental lead: ${lead.form.name || lead.form.email} · ${segment.label} · ${lead.id.slice(0, 8)}`,
      markdown_content: buildClickUpTaskMarkdown(lead),
      tags: uniqueClickUpTags(["oriental", lead.source, segment.id]),
      notify_all: false,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json().catch(() => null)) as {
    id?: string;
    url?: string;
    err?: string;
    ECODE?: string;
  } | null;
  if (!response.ok || !body?.id) {
    return { ok: false, error: body?.err ?? body?.ECODE ?? "clickup_api_error", status: response.status };
  }
  return {
    ok: true,
    transport: "clickup",
    externalId: body.id,
    ...(body.url ? { externalUrl: body.url } : {}),
  };
}

function clickUpListId() {
  const configured =
    readEnv("CLICKUP_LIST_ID") ??
    readEnv("CLICKUP_ORIENTAL_LIST_ID") ??
    readEnv("CLICKUP_LIST_URL") ??
    readEnv("CLICKUP_TARGET_URL");
  if (!configured) return undefined;
  const trimmed = configured.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.match(/\/li\/(\d+)/)?.[1] ?? trimmed.match(/\/list\/(\d+)/)?.[1];
}

function buildClickUpTaskMarkdown(lead: StoredLead) {
  const segment = getSegment(lead.segment);
  const transcript = lead.transcript
    .map((turn) => `- **${turn.role === "assistant" ? "Reka" : "Visitor"}:** ${turn.text}`)
    .join("\n");
  return [
    `## New Mereka at Oriental lead`,
    ``,
    `**Lead ID:** ${lead.id}`,
    `**Segment:** ${segment.label} (${segment.id})`,
    `**Source:** ${lead.source}`,
    `**Routed to:** ${lead.routedTo}${lead.routedToEmail ? ` <${lead.routedToEmail}>` : ""}`,
    ``,
    `### Contact`,
    `- **Name:** ${lead.form.name}`,
    `- **Email:** ${lead.form.email}`,
    `- **Organisation:** ${lead.form.org || "—"}`,
    `- **Phone:** ${lead.form.phone || "—"}`,
    `- **Website / socials:** ${lead.form.website || "—"}`,
    ``,
    `### Brief`,
    lead.form.message || "—",
    transcript ? `\n### Voice transcript\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function uniqueClickUpTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.toLowerCase().replace(/[^a-z0-9-]/g, "-")).filter(Boolean))];
}

export function routeLead(input: RoutableLead): StoredLead {
  const segment = getSegment(input.segment);
  return {
    ...input,
    id: crypto.randomUUID(),
    segment: segment.id,
    routedTo: segment.routedTo.name,
    routedToEmail: getOwnerEmail(segment.id),
  };
}
