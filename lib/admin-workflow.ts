export const ADMIN_LEAD_STATUSES = ["new", "reviewing", "contacted", "qualified", "archived"] as const;
export const ADMIN_WORKFLOW_LEAD_STATUSES = ["new", "reviewing", "contacted", "qualified"] as const;

export const ADMIN_LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const ADMIN_LEAD_OWNERS = ["Chewi", "Lala", "Jey", "Gurpreet", "Ambika", "Nadia", "AVI"] as const;

export const ADMIN_ACTIVE_LEAD_STATUSES = ["new", "reviewing", "contacted"] as const;
export const ADMIN_TERMINAL_LEAD_STATUSES = ["qualified", "archived"] as const;

export type AdminLeadStatus = (typeof ADMIN_LEAD_STATUSES)[number];
export type AdminLeadPriority = (typeof ADMIN_LEAD_PRIORITIES)[number];
export type AdminLeadOwner = (typeof ADMIN_LEAD_OWNERS)[number];

export type AdminLeadWorkflowInput = {
  status: AdminLeadStatus;
  owner: string;
  nextActionAt: number | null;
  nextActionNote?: string;
  outcomeReason?: string;
};

export type AdminLeadWorkflowIssue = {
  field: "status" | "owner" | "nextActionAt" | "nextActionNote" | "outcomeReason";
  message: string;
};

export type AdminLeadSlaState = {
  label: string;
  state: "closed" | "overdue" | "due-soon" | "scheduled" | "unscheduled";
};

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

export function isActiveAdminLeadStatus(status: AdminLeadStatus) {
  return ADMIN_ACTIVE_LEAD_STATUSES.includes(status as (typeof ADMIN_ACTIVE_LEAD_STATUSES)[number]);
}

export function isTerminalAdminLeadStatus(status: AdminLeadStatus) {
  return ADMIN_TERMINAL_LEAD_STATUSES.includes(status as (typeof ADMIN_TERMINAL_LEAD_STATUSES)[number]);
}

export function validateAdminLeadWorkflow(input: AdminLeadWorkflowInput, now = Date.now()): AdminLeadWorkflowIssue[] {
  const issues: AdminLeadWorkflowIssue[] = [];
  const owner = input.owner.trim();

  if (owner && !ADMIN_LEAD_OWNERS.includes(owner as AdminLeadOwner)) {
    issues.push({ field: "owner", message: "Choose an owner from the Oriental team roster." });
  }

  if (isActiveAdminLeadStatus(input.status)) {
    if (!owner) issues.push({ field: "owner", message: "Active enquiries need one accountable owner." });
    if (input.nextActionAt === null) {
      issues.push({ field: "nextActionAt", message: "Active enquiries need a dated next action." });
    } else if (input.nextActionAt < now - 60_000) {
      issues.push({ field: "nextActionAt", message: "The next action cannot be scheduled in the past." });
    }
    if (!input.nextActionNote?.trim()) {
      issues.push({ field: "nextActionNote", message: "Describe the next action so the owner knows what to do." });
    }
  }

  if (isTerminalAdminLeadStatus(input.status) && !input.outcomeReason?.trim()) {
    issues.push({ field: "outcomeReason", message: "Qualified and archived enquiries need an outcome reason." });
  }

  return issues;
}

export function adminLeadSlaState(
  status: AdminLeadStatus,
  nextActionAt: number | null | undefined,
  now = Date.now(),
): AdminLeadSlaState {
  if (isTerminalAdminLeadStatus(status)) return { label: "Closed", state: "closed" };
  if (!nextActionAt) return { label: "Next action missing", state: "unscheduled" };
  const remaining = nextActionAt - now;
  if (remaining < 0) return { label: "Next action overdue", state: "overdue" };
  if (remaining <= 24 * 60 * 60 * 1000) return { label: "Due within 24 hours", state: "due-soon" };
  return { label: "Next action scheduled", state: "scheduled" };
}
