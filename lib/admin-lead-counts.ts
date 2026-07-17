export type AdminLeadCountSource = {
  createdAt: number;
  notificationClickUpOk?: boolean | null;
  owner?: string | null;
  priority?: string | null;
  status: string;
};

export type AdminLeadCounts = {
  total: number;
  active: number;
  archived: number;
  qualified: number;
  unassignedActive: number;
  highPriorityActive: number;
  clickUpGaps: number;
  newToday: number;
};

const KUALA_LUMPUR_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function summarizeAdminLeads(leads: AdminLeadCountSource[], now = Date.now()): AdminLeadCounts {
  const isActive = (lead: AdminLeadCountSource) => lead.status !== "qualified" && lead.status !== "archived";

  return {
    total: leads.length,
    active: leads.filter(isActive).length,
    archived: leads.filter((lead) => lead.status === "archived").length,
    qualified: leads.filter((lead) => lead.status === "qualified").length,
    unassignedActive: leads.filter((lead) => isActive(lead) && !lead.owner?.trim()).length,
    highPriorityActive: leads.filter(
      (lead) => isActive(lead) && (lead.priority === "high" || lead.priority === "urgent"),
    ).length,
    clickUpGaps: leads.filter((lead) => lead.notificationClickUpOk !== true).length,
    newToday: leads.filter((lead) => isSameKualaLumpurDay(lead.createdAt, now)).length,
  };
}

function isSameKualaLumpurDay(left: number, right: number) {
  return Math.floor((left + KUALA_LUMPUR_OFFSET_MS) / DAY_MS) === Math.floor((right + KUALA_LUMPUR_OFFSET_MS) / DAY_MS);
}
