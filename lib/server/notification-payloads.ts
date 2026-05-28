import { getSegment } from "@/lib/segments";
import type { StoredLead } from "@/lib/server/notifications";

type OwnerNotification = {
  subject: string;
  text: string;
  html: string;
};

type SlackTextObject = {
  type: "mrkdwn" | "plain_text";
  text: string;
  emoji?: boolean;
};

type SlackBlock =
  | { type: "header"; text: SlackTextObject }
  | { type: "section"; text?: SlackTextObject; fields?: SlackTextObject[] };

export type SlackLeadPayload = {
  text: string;
  blocks: SlackBlock[];
};

export function buildOwnerNotification(lead: StoredLead): OwnerNotification {
  const segment = getSegment(lead.segment);
  const transcript = transcriptExcerpt(lead.transcript);
  const rows = [
    ["Lead ID", lead.id],
    ["Source", sourceLabel(lead.source)],
    ["Segment", `${segment.label} (${segment.id})`],
    ["Routed to", lead.routedTo],
    ["Name", lead.form.name],
    ["Email", lead.form.email],
    ["Organisation", lead.form.org],
  ] satisfies Array<[string, string]>;
  const subject = `[Oriental] ${segment.label} lead from ${lead.form.org}`;
  const text = [
    "New Oriental partner intake",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Brief",
    lead.form.message,
    ...(transcript ? ["", "Conversation context", transcript] : []),
    "",
    `Reply directly to ${lead.form.email} to continue the conversation.`,
  ].join("\n");
  const metadataRows = rows
    .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f1e8;color:#161318;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1e8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border:1px solid #ded7cb;">
            <tr>
              <td style="padding:32px 32px 20px;">
                <p style="margin:0 0 12px;color:#5a5146;font-size:12px;letter-spacing:.16em;text-transform:uppercase;">Oriental partner intake</p>
                <h1 style="margin:0;color:#161318;font-size:28px;line-height:1.2;font-weight:600;">${escapeHtml(segment.label)} lead from ${escapeHtml(lead.form.org)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:15px;line-height:1.5;">
                  ${metadataRows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;">
                <h2 style="margin:0 0 10px;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#5a5146;">Brief</h2>
                <div style="font-size:16px;line-height:1.6;color:#161318;">${htmlParagraph(lead.form.message)}</div>
              </td>
            </tr>
            ${
              transcript
                ? `<tr><td style="padding:0 32px 24px;"><h2 style="margin:0 0 10px;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#5a5146;">Conversation context</h2><div style="font-size:14px;line-height:1.6;color:#3d352f;background:#f6f1e8;border:1px solid #ded7cb;padding:16px;">${htmlParagraph(transcript)}</div></td></tr>`
                : ""
            }
            <tr>
              <td style="padding:24px 32px 32px;border-top:1px solid #ded7cb;color:#5a5146;font-size:14px;line-height:1.5;">
                Reply directly to <a href="${escapeHtml(mailtoHref(lead.form.email))}" style="color:#0f4c81;">${escapeHtml(lead.form.email)}</a> to continue the conversation.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export function buildSlackPayload(lead: StoredLead): SlackLeadPayload {
  const segment = getSegment(lead.segment);
  const transcript = transcriptExcerpt(lead.transcript, 4);
  const fields: SlackTextObject[] = [
    { type: "mrkdwn", text: `*Segment*\n${escapeSlack(segment.label)}` },
    { type: "mrkdwn", text: `*Source*\n${escapeSlack(sourceLabel(lead.source))}` },
    { type: "mrkdwn", text: `*Routed to*\n${escapeSlack(lead.routedTo)}` },
    { type: "mrkdwn", text: `*Lead ID*\n${escapeSlack(lead.id)}` },
    { type: "mrkdwn", text: `*Name*\n${escapeSlack(lead.form.name)}` },
    { type: "mrkdwn", text: `*Organisation*\n${escapeSlack(lead.form.org)}` },
    { type: "mrkdwn", text: `*Email*\n${escapeSlack(lead.form.email)}` },
  ];
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: truncate(`Oriental lead: ${segment.label}`, 150), emoji: false },
    },
    { type: "section", fields },
    { type: "section", text: { type: "mrkdwn", text: `*Brief*\n${escapeSlack(truncate(lead.form.message, 2800))}` } },
  ];
  if (transcript) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Conversation context*\n${escapeSlack(truncate(transcript, 2800))}` },
    });
  }

  return {
    text: `New Oriental lead for ${lead.routedTo}: ${lead.form.name} from ${lead.form.org}`,
    blocks,
  };
}

function sourceLabel(source: StoredLead["source"]): string {
  if (source === "hero-email") return "Hero email";
  if (source === "voice") return "Voice workspace";
  return "Typed form";
}

function transcriptExcerpt(transcript: StoredLead["transcript"], maxEntries = 6): string {
  return transcript
    .slice(-maxEntries)
    .map((entry) => `${speakerLabel(entry.role)}: ${entry.text.trim()}`)
    .filter((line) => line.length > 0)
    .join("\n");
}

function speakerLabel(role: StoredLead["transcript"][number]["role"]): string {
  if (role === "assistant") return "Mereka";
  if (role === "system") return "System";
  return "User";
}

function htmlParagraph(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeSlack(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email)}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
