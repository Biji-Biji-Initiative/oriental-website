import { buildCrmIntelligence, type CrmLeadLike } from "@/lib/admin-crm";
import {
  ADMIN_LEAD_STATUSES,
  type AdminLeadStatus,
  normalizeAdminLeadPriority,
  normalizeAdminLeadStatus,
} from "@/lib/admin-workflow";

const SLA_WINDOW_MS = 48 * 60 * 60 * 1000;
const SEVERELY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export type CommandCenterLeadLike = CrmLeadLike & {
  name: string;
  routedTo: string;
  source: string;
  notificationClickUpOk?: boolean;
};

export type CommandCenterReason = {
  label: string;
  tone: "neutral" | "blue" | "green" | "red" | "amber";
};

export type CommandCenterAttention<T extends CommandCenterLeadLike> = {
  lead: T;
  nextAction: string;
  reasons: CommandCenterReason[];
  score: number;
  severity: "critical" | "high" | "attention" | "routine";
};

export type CommandCenterCoverage = {
  key: "organization" | "brief" | "phone" | "owner" | "clickup";
  label: string;
  covered: number;
  total: number;
  percent: number | null;
  detail: string;
};

export type CommandCenterMix = {
  key: string;
  count: number;
  percent: number | null;
};

export function buildAdminCommandCenter<T extends CommandCenterLeadLike>(leads: T[], generatedAt: number) {
  const active = leads.filter(isActiveLead);
  const qualified = leads.filter((lead) => normalizeAdminLeadStatus(lead.status) === "qualified");
  const assigned = active.filter((lead) => Boolean(lead.owner?.trim()));
  const onTrack = active.filter((lead) => !isStale(lead, generatedAt));
  const delivered = leads.filter((lead) => lead.notificationDelivered === true);
  const failedDelivery = leads.filter((lead) => lead.notificationDelivered === false);
  const deliveryPending = leads.length - delivered.length - failedDelivery.length;
  const intelligence = buildCrmIntelligence(leads, generatedAt);

  const stageCounts = new Map<AdminLeadStatus, number>(ADMIN_LEAD_STATUSES.map((status) => [status, 0]));
  for (const lead of leads) {
    const status = normalizeAdminLeadStatus(lead.status);
    stageCounts.set(status, (stageCounts.get(status) ?? 0) + 1);
  }

  const attention = active
    .map((lead) => attentionItem(lead, generatedAt, intelligence.relationships.get(lead.leadId)))
    .sort((left, right) => right.score - left.score || right.lead.createdAt - left.lead.createdAt);

  const coverage: CommandCenterCoverage[] = [
    coverageRow(
      "organization",
      "Organisation",
      leads.filter((lead) => Boolean(lead.org.trim())).length,
      leads.length,
      "Account context captured",
    ),
    coverageRow(
      "brief",
      "Request brief",
      leads.filter((lead) => Boolean(lead.message.trim())).length,
      leads.length,
      "Useful follow-up context",
    ),
    coverageRow(
      "phone",
      "Phone",
      leads.filter((lead) => Boolean(lead.phone?.trim())).length,
      leads.length,
      "Optional direct-call channel",
    ),
    coverageRow("owner", "Owner", assigned.length, active.length, "Accountable open enquiries"),
    coverageRow(
      "clickup",
      "ClickUp",
      leads.filter((lead) => lead.notificationClickUpOk === true).length,
      leads.length,
      "Exact task mirror confirmed",
    ),
  ];

  return {
    attention,
    coverage,
    intelligence,
    kpis: {
      active: active.length,
      assignment: ratio(assigned.length, active.length),
      delivered: delivered.length,
      deliveryHealth: ratio(delivered.length, leads.length),
      deliveryPending,
      failedDelivery: failedDelivery.length,
      newToday: leads.filter((lead) => sameKualaLumpurDay(lead.createdAt, generatedAt)).length,
      qualified: qualified.length,
      sla: ratio(onTrack.length, active.length),
      stale: active.length - onTrack.length,
      total: leads.length,
      unassigned: active.length - assigned.length,
    },
    mixes: {
      routes: buildMix(leads, (lead) => lead.routedTo || "Unrouted"),
      segments: buildMix(leads, (lead) => lead.segment || "other"),
      sources: buildMix(leads, (lead) => lead.source || "unknown"),
    },
    stages: ADMIN_LEAD_STATUSES.map((status) => ({
      status,
      count: stageCounts.get(status) ?? 0,
      percent: ratio(stageCounts.get(status) ?? 0, leads.length),
    })),
  };
}

function attentionItem<T extends CommandCenterLeadLike>(
  lead: T,
  generatedAt: number,
  relationship?: { accountEnquiryCount: number; contactEnquiryCount: number },
): CommandCenterAttention<T> {
  const reasons: CommandCenterReason[] = [];
  const priority = normalizeAdminLeadPriority(lead.priority);
  const age = Math.max(generatedAt - (lead.lastReviewedAt ?? lead.createdAt), 0);
  let score = 0;

  if (lead.notificationDelivered === false) {
    score += 120;
    reasons.push({ label: "Delivery failed", tone: "red" });
  }
  if (priority === "urgent") {
    score += 95;
    reasons.push({ label: "Urgent", tone: "red" });
  } else if (priority === "high") {
    score += 70;
    reasons.push({ label: "High priority", tone: "amber" });
  }
  if (!lead.owner?.trim()) {
    score += 40;
    reasons.push({ label: "Unassigned", tone: "amber" });
  }
  if (age > SEVERELY_STALE_MS) {
    score += 35;
    reasons.push({ label: "7d+ stale", tone: "amber" });
  } else if (age > SLA_WINDOW_MS) {
    score += 20;
    reasons.push({ label: "SLA risk", tone: "amber" });
  }
  if (!lead.message.trim()) {
    score += 12;
    reasons.push({ label: "Brief missing", tone: "neutral" });
  }
  if (!lead.org.trim()) {
    score += 8;
    reasons.push({ label: "Organisation missing", tone: "neutral" });
  }
  if (lead.notificationClickUpOk !== true) {
    score += 20;
    reasons.push({ label: "ClickUp gap", tone: "red" });
  }
  if ((relationship?.contactEnquiryCount ?? 0) > 1) {
    score += 8;
    reasons.push({ label: "Repeat contact", tone: "blue" });
  } else if ((relationship?.accountEnquiryCount ?? 0) > 1) {
    score += 5;
    reasons.push({ label: "Account history", tone: "blue" });
  }
  if (reasons.length === 0) reasons.push({ label: "Recent open enquiry", tone: "blue" });

  const severity =
    lead.notificationDelivered === false || priority === "urgent"
      ? "critical"
      : priority === "high" || score >= 100
        ? "high"
        : score >= 40
          ? "attention"
          : "routine";
  const nextAction =
    lead.notificationDelivered === false
      ? "Recover delivery"
      : !lead.owner?.trim()
        ? "Assign an owner"
        : priority === "urgent" || priority === "high"
          ? "Follow up today"
          : age > SLA_WINDOW_MS
            ? "Contact or close"
            : !lead.message.trim()
              ? "Complete the brief"
              : "Review enquiry";

  return { lead, nextAction, reasons, score, severity };
}

function coverageRow(
  key: CommandCenterCoverage["key"],
  label: string,
  covered: number,
  total: number,
  detail: string,
): CommandCenterCoverage {
  return { key, label, covered, total, percent: ratio(covered, total), detail };
}

function buildMix<T>(items: T[], keyFor: (item: T) => string): CommandCenterMix[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item).trim() || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, percent: ratio(count, items.length) }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function ratio(numerator: number, denominator: number) {
  return denominator <= 0 ? null : Math.round((numerator / denominator) * 100);
}

function isActiveLead(lead: CommandCenterLeadLike) {
  const status = normalizeAdminLeadStatus(lead.status);
  return status !== "qualified" && status !== "archived";
}

function isStale(lead: CommandCenterLeadLike, generatedAt: number) {
  return generatedAt - (lead.lastReviewedAt ?? lead.createdAt) > SLA_WINDOW_MS;
}

function sameKualaLumpurDay(left: number, right: number) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  });
  return formatter.format(left) === formatter.format(right);
}
