import { readEnv } from "@/lib/env";

type AlertSeverity = "warning" | "error" | "critical";

type OpsAlert = {
  event: string;
  severity: AlertSeverity;
  summary: string;
  meta?: Record<string, unknown>;
  fingerprint?: string;
};

const throttleMs = 15 * 60 * 1000;
const fetchTimeoutMs = 2500;
const recentAlerts = new Map<string, number>();

export async function sendOpsAlert(alert: OpsAlert) {
  if (readEnv("NODE_ENV") === "test") return { ok: false, skipped: true, reason: "test" };
  const key = `${alert.event}:${alert.fingerprint ?? alert.summary}`;
  const now = Date.now();
  const lastSentAt = recentAlerts.get(key) ?? 0;
  if (now - lastSentAt < throttleMs) return { ok: false, skipped: true, reason: "throttled" };
  recentAlerts.set(key, now);

  const token = readEnv("SLACK_BOT_TOKEN");
  const channel = readEnv("OPS_ALERT_SLACK_CHANNEL_ID") ?? readEnv("SLACK_CHANNEL_ID") ?? readEnv("SLACK_CHANNEL");
  if (token && channel) {
    return await postSlackBotAlert(token, channel, alert);
  }

  const webhookUrl = readEnv("OPS_ALERT_SLACK_WEBHOOK_URL") ?? readEnv("SLACK_WEBHOOK_URL");
  if (webhookUrl) return await postSlackWebhookAlert(webhookUrl, alert);
  return { ok: false, skipped: true, reason: "slack_unconfigured" };
}

function alertText(alert: OpsAlert) {
  return `[${alert.severity.toUpperCase()}] ${alert.event}: ${alert.summary}`;
}

function alertBlocks(alert: OpsAlert) {
  const fields = Object.entries(alert.meta ?? {})
    .slice(0, 8)
    .map(([key, value]) => ({
      type: "mrkdwn",
      text: `*${key}*\n${formatValue(value)}`,
    }));
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `Oriental ${alert.severity.toUpperCase()} alert` },
    },
    { type: "section", text: { type: "mrkdwn", text: `*${alert.event}*\n${alert.summary}` } },
    ...(fields.length > 0 ? [{ type: "section", fields }] : []),
  ];
}

async function postSlackBotAlert(token: string, channel: string, alert: OpsAlert) {
  const response = await fetchWithTimeout("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text: alertText(alert), blocks: alertBlocks(alert) }),
  });
  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || body?.ok !== true) {
    return { ok: false, error: body?.error ?? "slack_api_error", status: response.status };
  }
  return { ok: true, transport: "slack" };
}

async function postSlackWebhookAlert(webhookUrl: string, alert: OpsAlert) {
  const response = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: alertText(alert), blocks: alertBlocks(alert) }),
  });
  if (!response.ok) return { ok: false, error: "slack_http_error", status: response.status };
  return { ok: true, transport: "slack" };
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "n/a";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return `\`${JSON.stringify(value).slice(0, 240)}\``;
}
