export const ADMIN_LEAD_STATUSES = ["new", "reviewing", "contacted", "qualified", "archived"] as const;

export const ADMIN_LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type AdminLeadStatus = (typeof ADMIN_LEAD_STATUSES)[number];
export type AdminLeadPriority = (typeof ADMIN_LEAD_PRIORITIES)[number];

export const adminLeadStatusLabels: Record<AdminLeadStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  contacted: "Contacted",
  qualified: "Qualified",
  archived: "Archived",
};

export const adminLeadPriorityLabels: Record<AdminLeadPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function normalizeAdminLeadStatus(value: string | null | undefined): AdminLeadStatus {
  return ADMIN_LEAD_STATUSES.includes(value as AdminLeadStatus) ? (value as AdminLeadStatus) : "new";
}

export function normalizeAdminLeadPriority(value: string | null | undefined): AdminLeadPriority {
  return ADMIN_LEAD_PRIORITIES.includes(value as AdminLeadPriority) ? (value as AdminLeadPriority) : "normal";
}
