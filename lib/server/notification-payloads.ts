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
  | { type: "section"; text?: SlackTextObject; fields?: SlackTextObject[] }
  | { type: "context"; elements: SlackTextObject[] }
  | { type: "divider" };

export type SlackLeadPayload = {
  text: string;
  blocks: SlackBlock[];
};

export function buildOwnerNotification(lead: StoredLead): OwnerNotification {
  const segment = getSegment(lead.segment);
  const transcript = transcriptExcerpt(lead.transcript);
  const rows: Array<[string, string]> = [
    ["Lead ID", lead.id],
    ["Source", sourceLabel(lead.source)],
    ["Segment", `${segment.label} (${segment.id})`],
    ["Routed to", lead.routedTo],
    ["Name", lead.form.name || "—"],
    ["Email", lead.form.email],
    ["Organisation", lead.form.org || "—"],
  ];
  if (lead.form.phone) rows.push(["Phone", lead.form.phone]);
  if (lead.form.website) rows.push(["Website / Socials", lead.form.website]);
  const subject = `[Oriental] ${segment.label} lead from ${lead.form.org || lead.form.name || "a new partner"}`;
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
    .map(([label, value], index) => {
      const border = index > 0 ? "border-top:1px solid #e9e4da;" : "";
      return [
        "<tr>",
        `<th scope="row" style="${border}text-align:left;vertical-align:top;padding:11px 24px 11px 0;color:#5f5950;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;">${escapeHtml(label)}</th>`,
        `<td style="${border}padding:11px 0;color:#100d18;font-size:15px;line-height:1.5;">${escapeHtml(value)}</td>`,
        "</tr>",
      ].join("");
    })
    .join("");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f1ea;color:#100d18;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(lead.form.name)} (${escapeHtml(lead.form.org)}) — ${escapeHtml(segment.label.toLowerCase())} enquiry for Oriental.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:36px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;">
            <tr>
              <td style="background:#100d18;border-radius:20px 20px 0 0;padding:28px 36px 26px;">
                <p style="margin:0;color:#c9d5ec;font-size:11px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;">Oriental &#183; Partner Intake</p>
                <h1 style="margin:14px 0 0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.25;font-weight:400;">${escapeHtml(lead.form.name)} <span style="color:#c9d5ec;">&#8212;</span> ${escapeHtml(lead.form.org)}</h1>
                <p style="margin:10px 0 0;color:rgba(255,255,255,.64);font-size:14px;line-height:1.5;">A new ${escapeHtml(segment.label.toLowerCase())} conversation, routed to ${escapeHtml(lead.routedTo)}.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-left:1px solid #e3ddd2;border-right:1px solid #e3ddd2;padding:28px 36px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  ${metadataRows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border-left:1px solid #e3ddd2;border-right:1px solid #e3ddd2;padding:20px 36px 8px;">
                <p style="margin:0 0 10px;color:#5f5950;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">What they would bring</p>
                <div style="border-left:3px solid #c9d5ec;padding:4px 0 4px 18px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#100d18;">${htmlParagraph(lead.form.message)}</div>
              </td>
            </tr>
            ${
              transcript
                ? `<tr><td style="background:#ffffff;border-left:1px solid #e3ddd2;border-right:1px solid #e3ddd2;padding:20px 36px 8px;"><p style="margin:0 0 10px;color:#5f5950;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">From the conversation</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;border-radius:14px;"><tr><td style="padding:14px 18px;">${transcriptHtml(lead.transcript)}</td></tr></table></td></tr>`
                : ""
            }
            <tr>
              <td style="background:#ffffff;border:1px solid #e3ddd2;border-top:0;border-radius:0 0 20px 20px;padding:24px 36px 30px;">
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
                  <tr>
                    <td style="border-radius:999px;background:#1f3f7c;">
                      <a href="${escapeHtml(mailtoHref(lead.form.email))}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:999px;">Reply to ${escapeHtml(lead.form.name)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#5f5950;font-size:13px;line-height:1.6;">
                  Replies go straight to <a href="${escapeHtml(mailtoHref(lead.form.email))}" style="color:#1f3f7c;">${escapeHtml(lead.form.email)}</a>. They were promised a follow-up within two working days.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 36px 0;text-align:center;">
                <p style="margin:0;color:#9b948a;font-size:11px;letter-spacing:.08em;">MEREKA &#183; ORIENTAL BUILDING, KUALA LUMPUR &#183; OPENING 2027</p>
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

export function buildSubmitterConfirmation(lead: StoredLead, contactEmail?: string): OwnerNotification {
  const segment = getSegment(lead.segment);
  const subject = "We received your Oriental Building note";
  const name = lead.form.name.trim() || "there";
  const contactLine = contactEmail
    ? `If this is urgent, reply here or email ${contactEmail}.`
    : "If this is urgent, reply to this email.";
  const contactHtml = contactEmail
    ? `If this is urgent, reply here or email <a href="mailto:${escapeHtml(contactEmail)}" style="color:#1f3f7c;">${escapeHtml(contactEmail)}</a>.`
    : "If this is urgent, reply to this email.";
  const text = [
    `Hi ${name},`,
    "",
    "Thanks for reaching out about Oriental Building. We received your handoff and the Mereka team has a copy.",
    `Your note is routed under: ${segment.label}.`,
    lead.routedTo ? `Current team route: ${lead.routedTo}.` : "",
    "",
    `We will review it and follow up within two working days. ${contactLine}`,
    "",
    "Your note",
    lead.form.message || "No additional note provided.",
    "",
    "Mereka · Oriental Building, Kuala Lumpur",
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f1ea;color:#100d18;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e3ddd2;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#100d18;padding:28px 34px;">
                <p style="margin:0;color:#c9d5ec;font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;">Oriental Building</p>
                <h1 style="margin:12px 0 0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;font-weight:400;">Thanks, ${escapeHtml(name)}. We received your note.</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 34px 10px;color:#100d18;font-size:15px;line-height:1.65;">
                <p style="margin:0 0 14px;">Thanks for reaching out about Oriental Building. We received your handoff and the Mereka team has a copy.</p>
                <p style="margin:0 0 14px;">It is routed under <strong>${escapeHtml(segment.label)}</strong>${lead.routedTo ? ` and currently points to <strong>${escapeHtml(lead.routedTo)}</strong>` : ""}. We will review it and follow up within two working days.</p>
                <p style="margin:0 0 18px;">${contactHtml}</p>
                <p style="margin:0 0 8px;color:#5f5950;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;">Your note</p>
                <div style="border-left:3px solid #c9d5ec;padding:4px 0 4px 18px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:#100d18;">${htmlParagraph(lead.form.message || "No additional note provided.")}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 34px 30px;color:#9b948a;font-size:11px;letter-spacing:.08em;">MEREKA &#183; ORIENTAL BUILDING, KUALA LUMPUR &#183; OPENING 2027</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export function buildNewsletterConfirmation(email: string, contactEmail?: string): OwnerNotification {
  const contactLine = contactEmail
    ? `Questions? Reply here or email ${contactEmail}.`
    : "Questions? Reply to this email.";
  const contactHtml = contactEmail
    ? `Questions? Reply here or email <a href="mailto:${escapeHtml(contactEmail)}" style="color:#1f3f7c;">${escapeHtml(contactEmail)}</a>.`
    : "Questions? Reply to this email.";
  const subject = "You're on the Oriental Building updates list";
  const text = [
    "Hi there,",
    "",
    "Thanks for signing up for Oriental Building updates from Mereka.",
    "We will send occasional project news, partner-interest updates, and launch notes as the building moves toward opening in 2027.",
    contactLine,
    "",
    `Subscribed email: ${email}`,
    "",
    "Mereka · Oriental Building, Kuala Lumpur",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f1ea;color:#100d18;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e3ddd2;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#100d18;padding:28px 34px;">
                <p style="margin:0;color:#c9d5ec;font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;">Oriental Building</p>
                <h1 style="margin:12px 0 0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.25;font-weight:400;">You're on the updates list.</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 34px 10px;color:#100d18;font-size:15px;line-height:1.65;">
                <p style="margin:0 0 14px;">Thanks for signing up for Oriental Building updates from Mereka.</p>
                <p style="margin:0 0 14px;">We will send occasional project news, partner-interest updates, and launch notes as the building moves toward opening in 2027.</p>
                <p style="margin:0 0 18px;">${contactHtml}</p>
                <p style="margin:0;color:#5f5950;font-size:13px;line-height:1.6;">Subscribed email: ${escapeHtml(email)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 34px 30px;color:#9b948a;font-size:11px;letter-spacing:.08em;">MEREKA &#183; ORIENTAL BUILDING, KUALA LUMPUR &#183; OPENING 2027</td>
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
  const conversation = lead.transcript
    .slice(-4)
    .map((entry) => `*${escapeSlack(speakerLabel(entry.role))}:*  ${escapeSlack(truncate(entry.text.trim(), 400))}`)
    .filter((line) => line.length > 0)
    .join("\n");
  const contactLines = [
    `*${escapeSlack(lead.form.name || "New partner")}*${lead.form.org ? ` — ${escapeSlack(lead.form.org)}` : ""}`,
    `<mailto:${lead.form.email}|${escapeSlack(lead.form.email)}>`,
  ];
  if (lead.form.phone) contactLines.push(`Phone: ${escapeSlack(lead.form.phone)}`);
  if (lead.form.website) contactLines.push(`Web/Socials: ${escapeSlack(lead.form.website)}`);
  contactLines.push(`→ *${escapeSlack(lead.routedTo)}* · ${escapeSlack(segment.routedTo.role)}`);
  const intro = contactLines.join("\n");
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: truncate(`New Oriental lead · ${segment.label}`, 150), emoji: false },
    },
    { type: "section", text: { type: "mrkdwn", text: intro } },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Brief*\n>${escapeSlack(truncate(lead.form.message, 2800)).replaceAll("\n", "\n>")}`,
      },
    },
  ];
  if (conversation) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Conversation context*\n${truncate(conversation, 2800)}` },
    });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: escapeSlack(`✦ ${segment.label} · ${sourceLabel(lead.source)} · Lead ${lead.id}`),
      },
    ],
  });

  return {
    text: `New Oriental lead for ${lead.routedTo}: ${lead.form.name || "a new partner"}${lead.form.org ? ` from ${lead.form.org}` : ""}`,
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

function transcriptHtml(transcript: StoredLead["transcript"], maxEntries = 6): string {
  return transcript
    .slice(-maxEntries)
    .map((entry) => {
      const isReka = entry.role === "assistant";
      const labelColor = isReka ? "#1f3f7c" : "#5f5950";
      return `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#3d3830;"><span style="font-weight:700;letter-spacing:.04em;color:${labelColor};">${escapeHtml(speakerLabel(entry.role))}</span>&nbsp;&nbsp;${escapeHtml(entry.text.trim())}</p>`;
    })
    .join("");
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
