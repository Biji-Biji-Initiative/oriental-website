import { readEnv } from "@/lib/env";

export type PrivacyDeletionPlan = {
  leads: Array<{
    notificationEmailOk: boolean;
    notificationConfirmationOk: boolean;
    notificationSlackOk: boolean;
    notificationSlackMessageId?: string | null;
    notificationClickUpOk: boolean;
    notificationClickUpTaskId?: string | null;
  }>;
};

export function privacyManualCleanupCounts(plan: PrivacyDeletionPlan) {
  return plan.leads.reduce(
    (counts, lead) => {
      if (lead.notificationEmailOk) counts.ownerEmail += 1;
      if (lead.notificationConfirmationOk) counts.submitterEmail += 1;
      if (lead.notificationSlackOk && !lead.notificationSlackMessageId) counts.unaddressableSlack += 1;
      if (lead.notificationClickUpOk && !lead.notificationClickUpTaskId) counts.unaddressableClickUp += 1;
      return counts;
    },
    { ownerEmail: 0, submitterEmail: 0, unaddressableSlack: 0, unaddressableClickUp: 0 },
  );
}

export async function deleteAddressablePrivacyCopies(plan: PrivacyDeletionPlan) {
  const failures = { slack: 0, clickup: 0 };
  for (const lead of plan.leads) {
    if (lead.notificationSlackMessageId && !(await deleteSlackCopy(lead.notificationSlackMessageId))) {
      failures.slack += 1;
    }
    if (lead.notificationClickUpTaskId && !(await deleteClickUpCopy(lead.notificationClickUpTaskId))) {
      failures.clickup += 1;
    }
  }
  return { ok: failures.slack === 0 && failures.clickup === 0, failures };
}

async function deleteSlackCopy(reference: string) {
  const token = readEnv("SLACK_BOT_TOKEN");
  const separator = reference.indexOf(":");
  if (!token || separator < 1) return false;
  const channel = reference.slice(0, separator);
  const ts = reference.slice(separator + 1);
  if (!channel || !ts) return false;
  const response = await fetch("https://slack.com/api/chat.delete", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, ts }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response) return false;
  const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  return body?.ok === true || body?.error === "message_not_found";
}

async function deleteClickUpCopy(taskId: string) {
  const token = readEnv("CLICKUP_API_TOKEN") ?? readEnv("CLICKUP_API_KEY");
  if (!token) return false;
  const response = await fetch(`https://api.clickup.com/api/v2/task/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: { Authorization: token },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  return response?.ok === true || response?.status === 404;
}
