import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { readEnv } from "@/lib/env";
import type { LeadRequest } from "@/lib/schemas";
import { getOwnerEmail, getSegment } from "@/lib/segments";
import { buildOwnerNotification, buildSlackPayload } from "@/lib/server/notification-payloads";
import { sendSmtpMail } from "@/lib/server/smtp";

type RoutableLead = Omit<LeadRequest, "source"> & { source: LeadRequest["source"] | "hero-email" };

export type StoredLead = RoutableLead & {
  id: string;
  routedTo: string;
  routedToEmail: string | null;
};

export type NotificationResult =
  | { ok: true; transport: "smtp" | "sesv2" | "slack" }
  | { ok: false; skipped?: true; reason?: string; error?: string; status?: number };

export async function notifyOwner(lead: StoredLead): Promise<NotificationResult> {
  const from = readEnv("SES_FROM_ADDRESS") ?? readEnv("SES_FROM_EMAIL");
  if (!from || !lead.routedToEmail) {
    return { ok: false, skipped: true, reason: "email_unconfigured" };
  }

  const notification = buildOwnerNotification(lead);

  const smtpUser = readEnv("SMTP_USER") ?? readEnv("EMAIL_SERVER_USER");
  const smtpPassword = readEnv("SMTP_PASSWORD") ?? readEnv("EMAIL_SERVER_PASSWORD");
  const awsRegion = readEnv("AWS_REGION");
  const smtpHost = readEnv("SMTP_HOST") ?? (awsRegion ? `email-smtp.${awsRegion}.amazonaws.com` : undefined);
  const smtpPort = Number(readEnv("SMTP_PORT", "587"));
  if (smtpUser && smtpPassword && smtpHost) {
    await sendSmtpMail({
      host: smtpHost,
      port: smtpPort,
      username: smtpUser,
      password: smtpPassword,
      from,
      to: lead.routedToEmail,
      replyTo: lead.form.email,
      subject: notification.subject,
      text: notification.text,
      html: notification.html,
    });
    return { ok: true, transport: "smtp" };
  }

  if (!awsRegion) return { ok: false, skipped: true, reason: "ses_unconfigured" };

  const client = new SESv2Client({ region: awsRegion });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [lead.routedToEmail] },
      ReplyToAddresses: [lead.form.email],
      Content: {
        Simple: {
          Subject: { Data: notification.subject },
          Body: {
            Text: {
              Data: notification.text,
            },
            Html: {
              Data: notification.html,
            },
          },
        },
      },
    }),
  );
  return { ok: true, transport: "sesv2" };
}

export async function notifySlack(lead: StoredLead): Promise<NotificationResult> {
  const slackWebhookUrl = readEnv("SLACK_WEBHOOK_URL");
  if (!slackWebhookUrl) {
    return { ok: false, skipped: true, reason: "slack_unconfigured" };
  }

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildSlackPayload(lead)),
  });
  if (!response.ok) {
    return { ok: false, error: "slack_http_error", status: response.status };
  }
  return { ok: true, transport: "slack" };
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
