import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { LeadRequest } from "@/lib/schemas";
import { getOwnerEmail, getSegment } from "@/lib/segments";

type RoutableLead = Omit<LeadRequest, "source"> & { source: LeadRequest["source"] | "hero-email" };

export type StoredLead = RoutableLead & {
  id: string;
  routedTo: string;
  routedToEmail: string | null;
};

export async function notifyOwner(lead: StoredLead) {
  const from = process.env.SES_FROM_ADDRESS ?? process.env.SES_FROM_EMAIL;
  if (!from || !lead.routedToEmail || !process.env.AWS_REGION) {
    return { ok: false, skipped: true, reason: "ses_unconfigured" };
  }

  const client = new SESv2Client({ region: process.env.AWS_REGION });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [lead.routedToEmail] },
      ReplyToAddresses: [lead.form.email],
      Content: {
        Simple: {
          Subject: { Data: `Oriental partner lead: ${lead.form.org}` },
          Body: {
            Text: {
              Data: [
                `Segment: ${getSegment(lead.segment).label}`,
                `Name: ${lead.form.name}`,
                `Email: ${lead.form.email}`,
                `Organisation: ${lead.form.org}`,
                "",
                lead.form.message,
              ].join("\n"),
            },
          },
        },
      },
    }),
  );
  return { ok: true };
}

export async function notifySlack(lead: StoredLead) {
  if (!process.env.SLACK_WEBHOOK_URL) {
    return { ok: false, skipped: true, reason: "slack_unconfigured" };
  }

  const segment = getSegment(lead.segment);
  const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New Oriental lead for ${lead.routedTo}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*New Oriental lead* → ${segment.label}\n*${lead.form.name}* from *${lead.form.org}*\n${lead.form.email}`,
          },
        },
        { type: "section", text: { type: "mrkdwn", text: lead.form.message } },
      ],
    }),
  });
  return { ok: response.ok };
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
