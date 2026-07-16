import { normalizeAdminLeadPriority, normalizeAdminLeadStatus } from "@/lib/admin-workflow";

export const CRM_SORTS = ["newest", "attention", "oldest", "stale", "unassigned"] as const;

export type CrmSort = (typeof CRM_SORTS)[number];

export const crmSortLabels: Record<CrmSort, string> = {
  newest: "Newest first",
  attention: "Needs action",
  oldest: "Oldest first",
  stale: "Stalest first",
  unassigned: "Unassigned first",
};

export type CrmLeadLike = {
  leadId: string;
  email: string;
  org: string;
  phone?: string;
  message: string;
  segment: string;
  status: string;
  priority?: string;
  owner?: string;
  notificationDelivered?: boolean;
  createdAt: number;
  lastReviewedAt?: number;
};

export type CrmAccountSummary = {
  key: string;
  name: string;
  enquiryCount: number;
  contactCount: number;
  openCount: number;
  highPriorityCount: number;
  latestAt: number;
  segments: string[];
};

export type CrmOwnerWorkload = {
  owner: string;
  openCount: number;
  highPriorityCount: number;
  staleCount: number;
  latestAt: number;
};

export type CrmRelationshipSummary<T extends CrmLeadLike> = {
  accountEnquiryCount: number;
  contactEnquiryCount: number;
  possibleDuplicateCount: number;
  relatedLeads: T[];
};

export type CrmIntelligence<T extends CrmLeadLike> = {
  accounts: CrmAccountSummary[];
  duplicateClusterCount: number;
  duplicateLeadIds: Set<string>;
  multiEnquiryAccountCount: number;
  organizationCoverage: number;
  ownerWorkloads: CrmOwnerWorkload[];
  repeatContactCount: number;
  relationships: Map<string, CrmRelationshipSummary<T>>;
  uniqueOrganizationCount: number;
};

const EMPTY_ORGANISATIONS = new Set(["", "n a", "na", "none", "not applicable", "unknown"]);
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function buildCrmIntelligence<T extends CrmLeadLike>(leads: T[], generatedAt: number): CrmIntelligence<T> {
  const organizations = groupBy(leads, (lead) => organizationKey(lead.org));
  const contacts = groupBy(leads, (lead) => contactKey(lead));
  const duplicateClusters = buildDuplicateClusters(leads);
  const duplicateLeadIds = new Set(duplicateClusters.flatMap((cluster) => cluster.map((lead) => lead.leadId)));
  const relationships = new Map<string, CrmRelationshipSummary<T>>();

  for (const lead of leads) {
    const sameAccount = organizations.get(organizationKey(lead.org)) ?? [];
    const sameContact = contacts.get(contactKey(lead)) ?? [];
    const possibleDuplicates = duplicateClusters.find((cluster) =>
      cluster.some((entry) => entry.leadId === lead.leadId),
    );
    const related = uniqueByLeadId([...sameContact, ...sameAccount])
      .filter((entry) => entry.leadId !== lead.leadId)
      .sort((left, right) => right.createdAt - left.createdAt);
    relationships.set(lead.leadId, {
      accountEnquiryCount: sameAccount.length,
      contactEnquiryCount: sameContact.length,
      possibleDuplicateCount: Math.max((possibleDuplicates?.length ?? 1) - 1, 0),
      relatedLeads: related,
    });
  }

  const accounts = [...organizations.entries()]
    .map(([key, entries]) => ({
      key,
      name: preferredOrganizationName(entries),
      enquiryCount: entries.length,
      contactCount: new Set(entries.map(contactKey)).size,
      openCount: entries.filter(isOpenLead).length,
      highPriorityCount: entries.filter(isHighPriorityLead).length,
      latestAt: Math.max(...entries.map((lead) => lead.createdAt)),
      segments: [...new Set(entries.map((lead) => lead.segment))],
    }))
    .sort((left, right) => right.enquiryCount - left.enquiryCount || right.latestAt - left.latestAt);

  const capturedOrganizations = leads.filter((lead) => Boolean(organizationKey(lead.org))).length;
  return {
    accounts,
    duplicateClusterCount: duplicateClusters.length,
    duplicateLeadIds,
    multiEnquiryAccountCount: accounts.filter((account) => account.enquiryCount > 1).length,
    organizationCoverage: leads.length === 0 ? 0 : Math.round((capturedOrganizations / leads.length) * 100),
    ownerWorkloads: buildOwnerWorkloads(leads, generatedAt),
    repeatContactCount: [...contacts.values()].filter((entries) => entries.length > 1).length,
    relationships,
    uniqueOrganizationCount: accounts.length,
  };
}

export function sortCrmLeads<T extends CrmLeadLike>(leads: T[], sort: CrmSort, generatedAt: number) {
  return [...leads].sort((left, right) => {
    if (sort === "oldest") return left.createdAt - right.createdAt;
    if (sort === "stale") return reviewAge(left) - reviewAge(right) || right.createdAt - left.createdAt;
    if (sort === "unassigned") {
      const ownerDelta = Number(Boolean(left.owner?.trim())) - Number(Boolean(right.owner?.trim()));
      return ownerDelta || right.createdAt - left.createdAt;
    }
    if (sort === "attention") {
      return attentionScore(right, generatedAt) - attentionScore(left, generatedAt) || right.createdAt - left.createdAt;
    }
    return right.createdAt - left.createdAt;
  });
}

export function normalizeCrmSort(value: string): CrmSort {
  return CRM_SORTS.includes(value as CrmSort) ? (value as CrmSort) : "newest";
}

export function organizationKey(value: string | undefined) {
  const normalized = normalizeIdentity(value);
  return EMPTY_ORGANISATIONS.has(normalized) ? "" : normalized;
}

function contactKey(lead: CrmLeadLike) {
  const email = lead.email.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = lead.phone?.replace(/\D/g, "") ?? "";
  return phone.length >= 7 ? `phone:${phone}` : `lead:${lead.leadId}`;
}

function groupBy<T>(leads: T[], keyFor: (lead: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const lead of leads) {
    const key = keyFor(lead);
    if (!key) continue;
    const entries = grouped.get(key) ?? [];
    entries.push(lead);
    grouped.set(key, entries);
  }
  return grouped;
}

function buildDuplicateClusters<T extends CrmLeadLike>(leads: T[]) {
  const candidates = groupBy(leads, (lead) => `${contactKey(lead)}:${duplicateMessageKey(lead)}`);
  const clusters: T[][] = [];
  for (const entries of candidates.values()) {
    const ordered = [...entries].sort((left, right) => left.createdAt - right.createdAt);
    let cluster: T[] = [];
    for (const lead of ordered) {
      const previous = cluster.at(-1);
      if (!previous || lead.createdAt - previous.createdAt <= DUPLICATE_WINDOW_MS) {
        cluster.push(lead);
      } else {
        if (cluster.length > 1) clusters.push(cluster);
        cluster = [lead];
      }
    }
    if (cluster.length > 1) clusters.push(cluster);
  }
  return clusters;
}

function duplicateMessageKey(lead: CrmLeadLike) {
  return `${lead.segment}:${normalizeIdentity(lead.message).slice(0, 240)}`;
}

function preferredOrganizationName(entries: CrmLeadLike[]) {
  return (
    [...entries]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((lead) => lead.org.trim())
      .find(Boolean) ?? "Unnamed organisation"
  );
}

function buildOwnerWorkloads<T extends CrmLeadLike>(leads: T[], generatedAt: number) {
  const openLeads = leads.filter(isOpenLead);
  const grouped = groupBy(openLeads, (lead) => lead.owner?.trim() || "Unassigned");
  return [...grouped.entries()]
    .map(([owner, entries]) => ({
      owner,
      openCount: entries.length,
      highPriorityCount: entries.filter(isHighPriorityLead).length,
      staleCount: entries.filter((lead) => generatedAt - reviewAge(lead) > STALE_AFTER_MS).length,
      latestAt: Math.max(...entries.map((lead) => lead.createdAt)),
    }))
    .sort((left, right) => {
      if (left.owner === "Unassigned") return -1;
      if (right.owner === "Unassigned") return 1;
      return right.openCount - left.openCount || right.latestAt - left.latestAt;
    });
}

function attentionScore(lead: CrmLeadLike, generatedAt: number) {
  if (!isOpenLead(lead)) return -100;
  const priority = normalizeAdminLeadPriority(lead.priority);
  const priorityScore = { low: 0, normal: 1, high: 4, urgent: 7 }[priority];
  const deliveryScore = lead.notificationDelivered === false ? 6 : 0;
  const ownerScore = lead.owner?.trim() ? 0 : 3;
  const staleScore = generatedAt - reviewAge(lead) > STALE_AFTER_MS ? 2 : 0;
  return priorityScore + deliveryScore + ownerScore + staleScore;
}

function reviewAge(lead: CrmLeadLike) {
  return lead.lastReviewedAt ?? lead.createdAt;
}

function isOpenLead(lead: CrmLeadLike) {
  const status = normalizeAdminLeadStatus(lead.status);
  return status !== "qualified" && status !== "archived";
}

function isHighPriorityLead(lead: CrmLeadLike) {
  const priority = normalizeAdminLeadPriority(lead.priority);
  return isOpenLead(lead) && (priority === "high" || priority === "urgent");
}

function uniqueByLeadId<T extends CrmLeadLike>(leads: T[]) {
  return [...new Map(leads.map((lead) => [lead.leadId, lead])).values()];
}

function normalizeIdentity(value: string | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
