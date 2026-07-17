import { ArrowUpRightIcon, Building2Icon, MailIcon, PhoneIcon, UserRoundIcon } from "lucide-react";
import { AdminBulkAssignmentForm } from "@/components/admin/AdminBulkAssignmentForm";
import { AdminLeadWorkflowForm } from "@/components/admin/AdminLeadWorkflowForm";
import { Badge } from "@/components/admin/Badge";
import {
  buildCrmIntelligence,
  type CrmIntelligence,
  type CrmRelationshipSummary,
  type CrmSort,
  sortCrmLeads,
} from "@/lib/admin-crm";
import {
  adminLeadPriorityLabels,
  adminLeadSlaState,
  adminLeadStatusLabels,
  normalizeAdminLeadPriority,
  normalizeAdminLeadStatus,
} from "@/lib/admin-workflow";
import { getSegment } from "@/lib/segments";
import type { getAdminReviewDashboard } from "@/lib/server/convex";

type DashboardResult = Awaited<ReturnType<typeof getAdminReviewDashboard>>;
type DashboardData = Extract<DashboardResult, { ok: true }>["data"];
type LeadRow = DashboardData["leads"][number];
type VoiceSessionRow = DashboardData["voiceSessions"][number];
type LeadEventRow = DashboardData["leadEvents"][number];

type CrmFilters = {
  q: string;
  status: string;
  priority: string;
  source: string;
  sort: CrmSort;
};

type EnquiryCrmWorkspaceProps = {
  allLeads: LeadRow[];
  events: LeadEventRow[];
  filters: CrmFilters;
  generatedAt: number;
  leads: LeadRow[];
  selectedLeadId?: string;
  totalLeads: number;
  view: "all" | "today" | "leads";
  voiceSessions: VoiceSessionRow[];
};

export function EnquiryCrmWorkspace({
  allLeads,
  events,
  filters,
  generatedAt,
  leads,
  selectedLeadId,
  totalLeads,
  view,
  voiceSessions,
}: EnquiryCrmWorkspaceProps) {
  const intelligence = buildCrmIntelligence(allLeads, generatedAt);
  const ordered = sortCrmLeads(leads, filters.sort, generatedAt);
  const rowLimit = view === "today" && !hasFilters(filters) ? 12 : ordered.length;
  const visible = ordered.slice(0, rowLimit);
  const selected = ordered.find((lead) => lead.leadId === selectedLeadId) ?? visible.find(isActiveLead) ?? visible[0];
  const todayCount = allLeads.filter((lead) => isSameKualaLumpurDay(lead.createdAt, generatedAt)).length;
  const active = allLeads.filter(isActiveLead).length;
  const unassigned = allLeads.filter((lead) => isActiveLead(lead) && !lead.owner?.trim()).length;
  const important = allLeads.filter((lead) => {
    const priority = normalizeAdminLeadPriority(lead.priority);
    return isActiveLead(lead) && (priority === "high" || priority === "urgent");
  }).length;
  const clickUpGaps = allLeads.filter((lead) => lead.notificationClickUpOk !== true).length;

  return (
    <section className="grid scroll-mt-32 gap-4" id="crm-workspace">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="CRM summary">
        <CrmMetric label="New today" value={todayCount} detail="Saved in Kuala Lumpur today" tone="blue" />
        <CrmMetric label="Open pipeline" value={active} detail="Needs an operator outcome" tone="neutral" />
        <CrmMetric
          label="Unassigned"
          value={unassigned}
          detail="No accountable owner yet"
          tone={unassigned ? "amber" : "green"}
        />
        <CrmMetric
          label="High priority"
          value={important}
          detail="High or urgent open work"
          tone={important ? "amber" : "green"}
        />
        <CrmMetric
          label="ClickUp gaps"
          value={clickUpGaps}
          detail="Enquiries without confirmed ClickUp sync"
          tone={clickUpGaps ? "red" : "green"}
        />
      </section>

      <CrmIntelligencePanel filters={filters} generatedAt={generatedAt} intelligence={intelligence} view={view} />

      <AdminBulkAssignmentForm
        leads={ordered
          .filter(isActiveLead)
          .slice(0, 50)
          .map((lead) => ({
            leadId: lead.leadId,
            label: lead.name?.trim() || lead.email,
            meta: `${lead.org?.trim() || "No organisation"} · ${lead.owner?.trim() || "Unassigned"}`,
            revision: lead.workflowRevision ?? 0,
          }))}
      />

      <section className="overflow-hidden rounded-2xl border border-mk-ash/20 bg-white shadow-sm" id="enquiry-table">
        <header className="flex flex-col gap-3 border-b border-mk-ash/15 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Enquiry pipeline</h2>
              <Badge tone="blue">{ordered.length} shown</Badge>
              {ordered.length !== totalLeads ? <Badge tone="neutral">{totalLeads} total</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-mk-ash">
              Scan the customer, request, stage, ownership, delivery, and recency in one CRM view.
            </p>
          </div>
          {view === "today" && totalLeads > visible.length ? (
            <a
              className="inline-flex h-9 items-center justify-center rounded-lg border border-mk-blue/20 bg-mk-blue/5 px-3 text-sm font-semibold text-mk-blue transition hover:border-mk-blue/40 hover:bg-mk-blue/10"
              href="/admin/session-review?view=leads#crm-workspace"
            >
              View all {totalLeads}
              <ArrowUpRightIcon className="ml-1.5 size-4" />
            </a>
          ) : null}
        </header>

        {visible.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-semibold">No enquiries match these filters.</p>
            <p className="mt-1 text-sm text-mk-ash">Reset the filters to return to the complete pipeline.</p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1180px] border-collapse text-left text-sm" data-crm-table>
                <caption className="sr-only">Oriental enquiries ordered newest first</caption>
                <thead className="bg-mk-paper/90 text-[11px] font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">
                  <tr>
                    <th className="w-[22%] px-4 py-3" scope="col">
                      Contact
                    </th>
                    <th className="w-[27%] px-4 py-3" scope="col">
                      Request
                    </th>
                    <th className="w-[13%] px-4 py-3" scope="col">
                      Source &amp; route
                    </th>
                    <th className="w-[15%] px-4 py-3" scope="col">
                      Pipeline
                    </th>
                    <th className="w-[11%] px-4 py-3" scope="col">
                      Delivery
                    </th>
                    <th className="w-[9%] px-4 py-3" scope="col">
                      Received
                    </th>
                    <th className="px-4 py-3 text-right" scope="col">
                      Record
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mk-ash/12">
                  {visible.map((lead) => (
                    <CrmTableRow
                      filters={filters}
                      generatedAt={generatedAt}
                      key={lead.leadId}
                      lead={lead}
                      relationship={intelligence.relationships.get(lead.leadId)}
                      selected={selected?.leadId === lead.leadId}
                      view={view}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-mk-ash/12 lg:hidden">
              {visible.map((lead) => (
                <CrmMobileRow
                  filters={filters}
                  generatedAt={generatedAt}
                  key={`mobile:${lead.leadId}`}
                  lead={lead}
                  relationship={intelligence.relationships.get(lead.leadId)}
                  selected={selected?.leadId === lead.leadId}
                  view={view}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {selected ? (
        <CrmRecord
          events={events.filter((event) => event.leadId === selected.leadId)}
          filters={filters}
          generatedAt={generatedAt}
          lead={selected}
          relationship={intelligence.relationships.get(selected.leadId)}
          view={view}
          voiceSession={voiceSessionForLead(selected, voiceSessions)}
        />
      ) : null}
    </section>
  );
}

function CrmMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "blue" | "green" | "red" | "amber";
}) {
  const toneClass = {
    neutral: "border-mk-ash/20 bg-white",
    blue: "border-mk-blue/20 bg-mk-blue/[0.04]",
    green: "border-emerald-700/20 bg-emerald-700/[0.04]",
    red: "border-destructive/20 bg-destructive/[0.04]",
    amber: "border-amber-700/20 bg-amber-500/[0.06]",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">{label}</span>
        <span className="text-2xl font-semibold tracking-tight text-mk-off-black">{value}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-mk-ash">{detail}</p>
    </div>
  );
}

function CrmIntelligencePanel({
  filters,
  generatedAt,
  intelligence,
  view,
}: {
  filters: CrmFilters;
  generatedAt: number;
  intelligence: CrmIntelligence<LeadRow>;
  view: EnquiryCrmWorkspaceProps["view"];
}) {
  const headlineStats = [
    { label: "Organizations", value: intelligence.uniqueOrganizationCount, detail: "captured accounts" },
    { label: "Multi-enquiry", value: intelligence.multiEnquiryAccountCount, detail: "accounts with history" },
    { label: "Repeat contacts", value: intelligence.repeatContactCount, detail: "people who returned" },
    { label: "Duplicate checks", value: intelligence.duplicateClusterCount, detail: "same request within 30m" },
    {
      label: "Account coverage",
      value: `${intelligence.organizationCoverage}%`,
      detail: "enquiries with organization",
    },
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-mk-blue/20 bg-white shadow-sm" id="crm-intelligence">
      <header className="border-b border-mk-ash/15 bg-gradient-to-r from-mk-blue/[0.08] via-white to-white px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mk-blue">
              Customer intelligence
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Account portfolio &amp; ownership</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-mk-ash">
              See organizations as accounts, recognize returning contacts, catch likely duplicate submissions, and
              balance follow-up ownership.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {headlineStats.map((stat) => (
              <div className="min-w-28 rounded-lg border border-mk-ash/15 bg-white/90 px-3 py-2" key={stat.label}>
                <div className="text-lg font-semibold tracking-tight">{stat.value}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mk-off-black/55">
                  {stat.label}
                </div>
                <div className="mt-0.5 text-[10px] text-mk-ash">{stat.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </header>
      <div className="grid xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,0.75fr)]">
        <section
          className="min-w-0 p-4 sm:p-5 xl:border-r xl:border-mk-ash/15"
          aria-labelledby="account-portfolio-title"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold" id="account-portfolio-title">
                Account portfolio
              </h3>
              <p className="mt-1 text-xs text-mk-ash">Highest-context organizations, ordered by enquiry history.</p>
            </div>
            <Badge tone="blue">
              {intelligence.accounts.length} {intelligence.accounts.length === 1 ? "account" : "accounts"}
            </Badge>
          </div>
          {intelligence.accounts.length === 0 ? (
            <p className="mt-4 rounded-lg bg-mk-paper p-4 text-sm text-mk-ash">
              Organization context has not been captured yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-mk-ash/15">
              <table className="w-full min-w-[660px] border-collapse text-left text-sm" data-account-table>
                <caption className="sr-only">Oriental organization account portfolio</caption>
                <thead className="bg-mk-paper/90 text-[10px] font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">
                  <tr>
                    <th className="px-3 py-2.5" scope="col">
                      Organization
                    </th>
                    <th className="px-3 py-2.5 text-right" scope="col">
                      Contacts
                    </th>
                    <th className="px-3 py-2.5 text-right" scope="col">
                      Enquiries
                    </th>
                    <th className="px-3 py-2.5 text-right" scope="col">
                      Open
                    </th>
                    <th className="px-3 py-2.5" scope="col">
                      Latest
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mk-ash/12">
                  {intelligence.accounts.slice(0, 7).map((account) => (
                    <tr className="bg-white hover:bg-mk-paper/50" key={account.key}>
                      <th className="px-3 py-3 font-normal" scope="row">
                        <a
                          className="font-semibold text-mk-blue hover:underline"
                          href={portfolioHref(view, filters, account.name)}
                        >
                          {account.name}
                        </a>
                        <div className="mt-1 text-xs text-mk-ash">
                          {account.segments
                            .slice(0, 2)
                            .map((segment) => getSegment(segment).label)
                            .join(" · ")}
                        </div>
                      </th>
                      <td className="px-3 py-3 text-right font-medium">{account.contactCount}</td>
                      <td className="px-3 py-3 text-right font-semibold">{account.enquiryCount}</td>
                      <td className="px-3 py-3 text-right">
                        <Badge tone={account.openCount > 0 ? "amber" : "green"}>{account.openCount}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-mk-ash">
                        {formatRelativeAge(account.latestAt, generatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="min-w-0 bg-mk-paper/30 p-4 sm:p-5" aria-labelledby="owner-workload-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold" id="owner-workload-title">
                Owner workload
              </h3>
              <p className="mt-1 text-xs text-mk-ash">Open work, priority pressure, and stale follow-up.</p>
            </div>
            <Badge tone={intelligence.ownerWorkloads.some((row) => row.owner === "Unassigned") ? "amber" : "green"}>
              {intelligence.ownerWorkloads.length} queues
            </Badge>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-mk-ash/15 bg-white">
            <table className="w-full min-w-[360px] border-collapse text-left text-sm" data-owner-table>
              <caption className="sr-only">Oriental enquiry owner workload</caption>
              <thead className="bg-mk-paper/90 text-[10px] font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">
                <tr>
                  <th className="px-3 py-2.5" scope="col">
                    Owner
                  </th>
                  <th className="px-3 py-2.5 text-right" scope="col">
                    Open
                  </th>
                  <th className="px-3 py-2.5 text-right" scope="col">
                    High
                  </th>
                  <th className="px-3 py-2.5 text-right" scope="col">
                    Stale
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mk-ash/12">
                {intelligence.ownerWorkloads.slice(0, 7).map((row) => (
                  <tr className="bg-white" key={row.owner}>
                    <th className="px-3 py-3 font-normal" scope="row">
                      <a
                        className={
                          row.owner === "Unassigned"
                            ? "font-semibold text-amber-800 hover:underline"
                            : "font-semibold text-mk-blue hover:underline"
                        }
                        href={portfolioHref(
                          view,
                          filters,
                          row.owner === "Unassigned" ? "" : row.owner,
                          row.owner === "Unassigned",
                        )}
                      >
                        {row.owner}
                      </a>
                    </th>
                    <td className="px-3 py-3 text-right font-semibold">{row.openCount}</td>
                    <td className="px-3 py-3 text-right">{row.highPriorityCount}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={row.staleCount > 0 ? "font-semibold text-amber-800" : "text-mk-ash"}>
                        {row.staleCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}

function CrmTableRow({
  filters,
  generatedAt,
  lead,
  relationship,
  selected,
  view,
}: {
  filters: CrmFilters;
  generatedAt: number;
  lead: LeadRow;
  relationship?: CrmRelationshipSummary<LeadRow>;
  selected: boolean;
  view: EnquiryCrmWorkspaceProps["view"];
}) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  const delivery = notificationStatus(lead);
  return (
    <tr
      className={selected ? "bg-mk-blue/[0.045]" : "bg-white transition hover:bg-mk-paper/60"}
      data-lead-id={lead.leadId}
    >
      <th className="px-4 py-3.5 align-top font-normal" scope="row">
        <div className="font-semibold text-mk-off-black">{lead.name?.trim() || "Unnamed visitor"}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-mk-ash">
          <Building2Icon className="size-3.5 shrink-0" />
          <span className="truncate">{lead.org?.trim() || "Organisation not captured"}</span>
        </div>
        <a
          className="mt-1.5 block truncate text-xs font-medium text-mk-blue hover:underline"
          href={`mailto:${encodeURIComponent(lead.email)}`}
        >
          {lead.email}
        </a>
        <RelationshipBadges relationship={relationship} />
      </th>
      <td className="px-4 py-3.5 align-top">
        <p className="line-clamp-2 leading-5 text-mk-off-black">
          {lead.message?.trim() || "No request brief captured."}
        </p>
        <div className="mt-2 text-xs text-mk-ash">{getSegment(lead.segment).label}</div>
      </td>
      <td className="px-4 py-3.5 align-top">
        <Badge tone={lead.source === "voice" ? "blue" : "neutral"}>{leadSourceLabel(lead.source)}</Badge>
        <div className="mt-2 text-xs text-mk-ash">
          Route: <span className="font-medium text-mk-off-black">{lead.routedTo || "Not set"}</span>
        </div>
      </td>
      <td className="px-4 py-3.5 align-top">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
          <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-mk-ash">
          <UserRoundIcon className="size-3.5" />
          <span className={lead.owner?.trim() ? "text-mk-off-black" : "font-semibold text-amber-800"}>
            {lead.owner?.trim() || "Unassigned"}
          </span>
        </div>
      </td>
      <td className="px-4 py-3.5 align-top">
        <Badge tone={delivery.tone}>{delivery.label}</Badge>
        <ClickUpTaskLink compact lead={lead} />
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-mk-ash">{deliverySummary(lead)}</p>
      </td>
      <td className="px-4 py-3.5 align-top">
        <div className="font-semibold text-mk-off-black">{formatRelativeAge(lead.createdAt, generatedAt)}</div>
        <div className="mt-1 text-xs leading-5 text-mk-ash">{formatDate(lead.createdAt)}</div>
      </td>
      <td className="px-4 py-3.5 text-right align-top">
        <a
          aria-label={`Open ${lead.name || lead.email} enquiry record`}
          className="inline-flex h-8 items-center rounded-lg border border-mk-blue/20 bg-white px-3 text-xs font-semibold text-mk-blue transition hover:border-mk-blue/45 hover:bg-mk-blue/5"
          href={recordHref(view, filters, lead.leadId)}
        >
          Open
        </a>
      </td>
    </tr>
  );
}

function CrmMobileRow({
  filters,
  generatedAt,
  lead,
  relationship,
  selected,
  view,
}: {
  filters: CrmFilters;
  generatedAt: number;
  lead: LeadRow;
  relationship?: CrmRelationshipSummary<LeadRow>;
  selected: boolean;
  view: EnquiryCrmWorkspaceProps["view"];
}) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  return (
    <article className={`p-4 ${selected ? "bg-mk-blue/[0.045]" : "bg-white"}`} data-lead-id={lead.leadId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{lead.name?.trim() || "Unnamed visitor"}</div>
          <div className="mt-1 truncate text-xs text-mk-ash">{lead.org?.trim() || lead.email}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-mk-ash">{formatRelativeAge(lead.createdAt, generatedAt)}</div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-5">{lead.message?.trim() || "No request brief captured."}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
        <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
        <Badge tone={lead.owner?.trim() ? "green" : "amber"}>{lead.owner?.trim() || "Unassigned"}</Badge>
      </div>
      <RelationshipBadges relationship={relationship} />
      <a
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-mk-blue/20 bg-mk-blue/5 text-sm font-semibold text-mk-blue"
        href={recordHref(view, filters, lead.leadId)}
      >
        Open CRM record
      </a>
    </article>
  );
}

function CrmRecord({
  events,
  filters,
  generatedAt,
  lead,
  relationship,
  view,
  voiceSession,
}: {
  events: LeadEventRow[];
  filters: CrmFilters;
  generatedAt: number;
  lead: LeadRow;
  relationship?: CrmRelationshipSummary<LeadRow>;
  view: EnquiryCrmWorkspaceProps["view"];
  voiceSession?: VoiceSessionRow;
}) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  const delivery = notificationStatus(lead);
  const website = safeWebsiteHref(lead.website);
  const orderedEvents = [...events].sort((left, right) => right.createdAt - left.createdAt);
  const sla = adminLeadSlaState(status, lead.nextActionAt, generatedAt);
  return (
    <section
      className="scroll-mt-28 overflow-hidden rounded-2xl border border-mk-ash/20 bg-white shadow-sm"
      id="crm-record"
    >
      <header className="border-b border-mk-ash/15 bg-gradient-to-r from-mk-blue/[0.07] via-white to-white px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.13em] text-mk-blue">Enquiry record</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{lead.name?.trim() || "Unnamed visitor"}</h2>
            <p className="mt-1 text-sm text-mk-ash">{lead.org?.trim() || "Organisation not captured"}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
              <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
              <Badge tone={lead.owner?.trim() ? "green" : "amber"}>{lead.owner?.trim() || "Unassigned"}</Badge>
              <Badge tone={delivery.tone}>{delivery.label}</Badge>
              <Badge tone={slaTone(sla.state)}>{sla.label}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex h-10 items-center rounded-lg bg-mk-off-black px-4 text-sm font-semibold text-white transition hover:bg-mk-blue"
              href={`mailto:${encodeURIComponent(lead.email)}`}
            >
              <MailIcon className="mr-2 size-4" /> Email
            </a>
            {lead.phone ? (
              <a
                className="inline-flex h-10 items-center rounded-lg border border-mk-ash/20 bg-white px-4 text-sm font-semibold transition hover:border-mk-blue/40"
                href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}
              >
                <PhoneIcon className="mr-2 size-4" /> Call
              </a>
            ) : null}
            {website ? (
              <a
                className="inline-flex h-10 items-center rounded-lg border border-mk-ash/20 bg-white px-4 text-sm font-semibold transition hover:border-mk-blue/40"
                href={website}
                rel="noreferrer"
                target="_blank"
              >
                Website <ArrowUpRightIcon className="ml-2 size-4" />
              </a>
            ) : null}
            <ClickUpTaskLink lead={lead} />
          </div>
        </div>
      </header>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="grid content-start gap-5 p-4 sm:p-6 xl:border-r xl:border-mk-ash/15">
          <section>
            <SectionLabel>What they want</SectionLabel>
            <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-mk-off-black">
              {lead.message?.trim() || "No request brief was captured for this enquiry."}
            </p>
          </section>

          <section className="rounded-xl border border-mk-ash/15 bg-mk-paper/45 p-4">
            <SectionLabel>CRM data</SectionLabel>
            <dl className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <DataField icon={<MailIcon className="size-4" />} label="Email" value={lead.email} />
              <DataField icon={<PhoneIcon className="size-4" />} label="Phone" value={lead.phone} />
              <DataField icon={<Building2Icon className="size-4" />} label="Organisation" value={lead.org} />
              <DataField label="Enquiry type" value={getSegment(lead.segment).label} />
              <DataField label="Source" value={leadSourceLabel(lead.source)} />
              <DataField label="Routed team" value={lead.routedTo} />
              <DataField label="Routed email" value={lead.routedToEmail} />
              <DataField label="Owner" value={lead.owner} />
              <DataField label="Received" value={formatDate(lead.createdAt)} />
              <DataField
                label="Last reviewed"
                value={lead.lastReviewedAt ? formatDate(lead.lastReviewedAt) : undefined}
              />
              <DataField
                label="Last delivery"
                value={lead.lastNotificationAt ? formatDate(lead.lastNotificationAt) : undefined}
              />
              <DataField label="ClickUp sync" value={clickUpStatus(lead.notificationClickUpOk)} />
              <DataField label="ClickUp task ID" value={lead.notificationClickUpTaskId} />
              <DataField label="Record age" value={formatRelativeAge(lead.createdAt, generatedAt)} />
            </dl>
          </section>

          {lead.workflowNote ? (
            <section className="rounded-xl border border-mk-blue/15 bg-mk-blue/[0.04] p-4">
              <SectionLabel>Latest workflow note</SectionLabel>
              <p className="mt-2 text-sm leading-6">{lead.workflowNote}</p>
            </section>
          ) : null}

          <InteractionEvidence lead={lead} voiceSession={voiceSession} />

          {lead.transcript.length > 0 ? (
            <details className="rounded-xl border border-mk-ash/15 bg-white" suppressHydrationWarning>
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
                Conversation transcript · {lead.transcript.length} turns
              </summary>
              <div className="grid gap-3 border-t border-mk-ash/15 p-4">
                {lead.transcript.map((turn: { role: string; text: string }) => (
                  <div className="rounded-lg bg-mk-paper p-3 text-sm leading-6" key={`${turn.role}:${turn.text}`}>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
                      {turn.role}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{turn.text}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {Object.keys(lead.utm ?? {}).length > 0 ? (
            <section>
              <SectionLabel>Acquisition metadata</SectionLabel>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(lead.utm).map(([key, value]) => (
                  <Badge key={key} tone="neutral">
                    {key}: {String(value)}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="grid content-start gap-5 bg-mk-paper/35 p-4 sm:p-6">
          <section>
            <SectionLabel>Next action</SectionLabel>
            <p className="mt-2 text-sm font-semibold leading-6 text-mk-off-black">
              {lead.nextActionNote?.trim() || leadActionHint(lead)}
            </p>
            {lead.nextActionAt ? (
              <p className="mt-1 text-xs leading-5 text-mk-ash">
                Due {formatDate(lead.nextActionAt)} · {sla.label}
              </p>
            ) : null}
            <AdminLeadWorkflowForm
              compact
              leadId={lead.leadId}
              initialNextActionAt={lead.nextActionAt}
              initialNextActionNote={lead.nextActionNote}
              initialOwner={lead.owner}
              initialOutcomeReason={lead.outcomeReason}
              initialPriority={priority}
              initialRevision={lead.workflowRevision}
              initialStatus={status}
            />
          </section>

          <DeliveryPanel lead={lead} />

          <section className="rounded-xl border border-mk-ash/15 bg-white p-4">
            <SectionLabel>Activity</SectionLabel>
            <div className="mt-3 grid gap-3">
              {orderedEvents.length === 0 ? (
                <p className="text-sm leading-6 text-mk-ash">No workflow activity has been recorded yet.</p>
              ) : (
                orderedEvents.slice(0, 8).map((event) => (
                  <div
                    className="grid grid-cols-[8px_minmax(0,1fr)] gap-3"
                    key={`${event.kind}:${event.createdAt}:${event.leadId}`}
                  >
                    <span className="mt-1.5 size-2 rounded-full bg-mk-blue" />
                    <div>
                      <div className="text-sm font-semibold">{eventLabel(event.kind)}</div>
                      <div className="mt-0.5 text-xs text-mk-ash">
                        {event.actor} · {formatDate(event.createdAt)}
                      </div>
                      {event.note ? <p className="mt-1 text-xs leading-5 text-mk-ash">{event.note}</p> : null}
                      {event.reason && event.reason !== event.note ? (
                        <p className="mt-1 text-xs leading-5 text-mk-ash">Reason: {event.reason}</p>
                      ) : null}
                      {event.changes?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {event.changes.map((change: { field: string; before?: string; after?: string }) => (
                            <span
                              className="rounded-full bg-mk-paper px-2 py-1 text-[10px] font-semibold text-mk-ash"
                              key={`${event.createdAt}:${change.field}`}
                            >
                              {auditFieldLabel(change.field)}: {auditValue(change.field, change.before)} →{" "}
                              {auditValue(change.field, change.after)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      <div className="border-t border-mk-ash/15 p-4 sm:p-6">
        <RelatedEnquiries
          filters={filters}
          generatedAt={generatedAt}
          lead={lead}
          relationship={relationship}
          view={view}
        />
      </div>
    </section>
  );
}

function InteractionEvidence({ lead, voiceSession }: { lead: LeadRow; voiceSession?: VoiceSessionRow }) {
  if (lead.source !== "voice") return null;
  const evaluation = voiceSession?.eval;
  if (!evaluation) {
    return (
      <section className="rounded-xl border border-amber-700/20 bg-amber-500/[0.07] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Reka interaction evaluation</SectionLabel>
          <Badge tone="amber">Pending</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-amber-950/75">
          The enquiry is safely stored. A 1–5 evaluation has not been persisted for this interaction yet.
        </p>
      </section>
    );
  }
  const scores = [
    ["Routing", evaluation.routingCorrect, false],
    ["Capture", evaluation.captureCompleteness, false],
    ["Quality", evaluation.conversationQuality, false],
    ["Frustration", evaluation.frustration, true],
  ] as const;
  return (
    <section className="rounded-xl border border-mk-blue/20 bg-mk-blue/[0.035] p-4" aria-label="Interaction evaluation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Reka interaction evaluation</SectionLabel>
        <Badge tone={evaluation.droppedMidTurn ? "red" : "green"}>
          {evaluation.droppedMidTurn ? "Dropped mid-turn" : "Completed"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {scores.map(([label, value, invert]) => (
          <div
            className="rounded-lg border border-mk-ash/12 bg-white p-3"
            data-eval-dimension={label.toLowerCase()}
            key={label}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">{label}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xl font-semibold">{value}/5</span>
              <Badge tone={scoreTone(value, invert)}>{scoreVerdict(value, invert)}</Badge>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-mk-ash">
        Higher is better for routing, capture, and quality. Lower is better for frustration.
      </p>
      {evaluation.summary ? <p className="mt-2 text-sm leading-6">{evaluation.summary}</p> : null}
    </section>
  );
}

function DataField({ icon, label, value }: { icon?: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">
        {icon}
        {label}
      </dt>
      <dd className={`mt-1 break-words text-sm ${value?.trim() ? "text-mk-off-black" : "italic text-mk-ash"}`}>
        {value?.trim() || "Not captured"}
      </dd>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-mk-off-black/55">{children}</div>;
}

function recordHref(view: EnquiryCrmWorkspaceProps["view"], filters: CrmFilters, leadId: string) {
  const params = new URLSearchParams({ view });
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.source) params.set("source", filters.source);
  params.set("sort", filters.sort);
  params.set("lead", leadId);
  return `/admin/session-review?${params.toString()}#crm-record`;
}

function portfolioHref(
  _view: EnquiryCrmWorkspaceProps["view"],
  filters: CrmFilters,
  query: string,
  unassigned = false,
) {
  const params = new URLSearchParams({ view: "leads", sort: unassigned ? "unassigned" : filters.sort });
  if (query) params.set("q", query);
  return `/admin/session-review?${params.toString()}#crm-workspace`;
}

function relationshipRecordHref(_view: EnquiryCrmWorkspaceProps["view"], filters: CrmFilters, leadId: string) {
  const params = new URLSearchParams({ view: "leads", sort: filters.sort, lead: leadId });
  return `/admin/session-review?${params.toString()}#crm-record`;
}

function hasFilters(filters: CrmFilters) {
  return Boolean(filters.q || filters.status || filters.priority || filters.source);
}

function voiceSessionForLead(lead: LeadRow, sessions: VoiceSessionRow[]) {
  return sessions.find(
    (session) =>
      (lead.voiceReviewId && session.reviewId === lead.voiceReviewId) ||
      (session.leadId && session.leadId === lead.leadId),
  );
}

function isActiveLead(lead: LeadRow) {
  const status = normalizeAdminLeadStatus(lead.status);
  return status !== "archived" && status !== "qualified";
}

function statusTone(status: ReturnType<typeof normalizeAdminLeadStatus>) {
  if (status === "qualified") return "green" as const;
  if (status === "archived") return "neutral" as const;
  if (status === "reviewing") return "blue" as const;
  return "amber" as const;
}

function priorityTone(priority: ReturnType<typeof normalizeAdminLeadPriority>) {
  if (priority === "urgent") return "red" as const;
  if (priority === "high") return "amber" as const;
  if (priority === "low") return "neutral" as const;
  return "blue" as const;
}

function slaTone(state: ReturnType<typeof adminLeadSlaState>["state"]): "neutral" | "green" | "red" | "amber" {
  if (state === "overdue") return "red";
  if (state === "due-soon" || state === "unscheduled") return "amber";
  if (state === "scheduled") return "green";
  return "neutral";
}

function notificationStatus(lead: LeadRow): { label: string; tone: "neutral" | "blue" | "green" | "red" | "amber" } {
  if (lead.notificationDelivered === false) return { label: "Failed", tone: "red" };
  const successes = [lead.notificationEmailOk, lead.notificationSlackOk, lead.notificationClickUpOk].filter(
    Boolean,
  ).length;
  if (successes > 0) return { label: successes > 1 ? `Sent +${successes - 1}` : "Sent", tone: "green" };
  if (lead.source === "hero-email") return { label: "Captured", tone: "green" };
  return { label: "Pending", tone: "amber" };
}

function deliverySummary(lead: LeadRow) {
  const delivered = [
    lead.notificationEmailOk === true ? "owner email" : null,
    lead.notificationSlackOk === true ? "team Slack" : null,
    lead.notificationClickUpOk === true ? "ClickUp" : null,
  ].filter((value): value is string => Boolean(value));
  if (delivered.length > 0) {
    const confirmation =
      lead.notificationConfirmationOk === true
        ? " The visitor confirmation was also sent."
        : lead.notificationConfirmationOk === false
          ? " The team has the enquiry, but the visitor confirmation failed."
          : "";
    return `Delivered through ${formatList(delivered)}.${confirmation}`;
  }
  if (lead.notificationDelivered === false)
    return "Saved safely, but no team delivery channel succeeded. Recover this handoff.";
  if (lead.source === "hero-email") return "Captured in the CRM. No team delivery outcome was recorded.";
  return "Saved in the CRM; delivery outcome has not been recorded yet.";
}

function deliveryChannelState(value: boolean | undefined): {
  label: string;
  tone: "green" | "red" | "amber";
} {
  if (value === true) return { label: "Delivered", tone: "green" };
  if (value === false) return { label: "Failed", tone: "red" };
  return { label: "Not recorded", tone: "amber" };
}

function clickUpStatus(value: boolean | undefined) {
  if (value === true) return "ClickUp synced";
  if (value === false) return "ClickUp failed";
  return "ClickUp not recorded";
}

function clickUpTextClass(value: boolean | undefined) {
  if (value === true) return "text-emerald-700";
  if (value === false) return "text-destructive";
  return "text-amber-800";
}

function leadActionHint(lead: LeadRow) {
  const status = normalizeAdminLeadStatus(lead.status);
  if (lead.notificationDelivered === false)
    return "Recover the failed notification, confirm delivery, and record the outcome.";
  if (!lead.owner?.trim() && isActiveLead(lead)) return "Assign an owner so one person is accountable for follow-up.";
  if (status === "new")
    return "Review the request, contact the visitor, and move the enquiry into the correct pipeline stage.";
  if (status === "reviewing") return "Record the next outbound step and keep the workflow note current.";
  if (status === "qualified") return "Confirm the opportunity owner and the agreed next milestone.";
  return "No immediate action is required. Reopen only if new customer context arrives.";
}

function eventLabel(kind: string) {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function auditFieldLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (character) => character.toUpperCase());
}

function auditValue(field: string, value: string | undefined) {
  if (!value) return "none";
  if (/At$/.test(field) && Number.isFinite(Number(value))) return formatDate(Number(value));
  return value;
}

function leadSourceLabel(source: LeadRow["source"]) {
  if (source === "voice") return "Reka voice";
  if (source === "hero-email") return "Email interest";
  return "Website form";
}

function safeWebsiteHref(value: string | undefined) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeClickUpHref(value: string | undefined, taskId: string | undefined) {
  if (value?.trim()) {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        (url.hostname === "app.clickup.com" || url.hostname === "clickup.com" || url.hostname.endsWith(".clickup.com"))
      ) {
        return url.toString();
      }
    } catch {
      // Fall through to the task ID if the provider URL was malformed.
    }
  }
  const cleanTaskId = taskId?.trim();
  return cleanTaskId && /^[A-Za-z0-9_-]+$/.test(cleanTaskId)
    ? `https://app.clickup.com/t/${encodeURIComponent(cleanTaskId)}`
    : undefined;
}

function scoreTone(value: number, invert: boolean): "green" | "amber" | "red" {
  const normalized = invert ? 5 - value : value;
  if (normalized >= 3.75) return "green";
  if (normalized >= 2.5) return "amber";
  return "red";
}

function scoreVerdict(value: number, invert: boolean) {
  const normalized = invert ? 5 - value : value;
  if (normalized >= 3.75) return "Healthy";
  if (normalized >= 2.5) return "Watch";
  return "Needs work";
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function formatRelativeAge(value: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - value) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isSameKualaLumpurDay(left: number, right: number) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  return format.format(new Date(left)) === format.format(new Date(right));
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function RelationshipBadges({ relationship }: { relationship?: CrmRelationshipSummary<LeadRow> }) {
  if (
    !relationship ||
    (relationship.contactEnquiryCount <= 1 &&
      relationship.accountEnquiryCount <= 1 &&
      relationship.possibleDuplicateCount === 0)
  ) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {relationship.contactEnquiryCount > 1 ? (
        <Badge tone="blue">Repeat contact · {relationship.contactEnquiryCount}</Badge>
      ) : null}
      {relationship.accountEnquiryCount > 1 ? (
        <Badge tone="neutral">Account · {relationship.accountEnquiryCount}</Badge>
      ) : null}
      {relationship.possibleDuplicateCount > 0 ? (
        <Badge tone="amber">Check duplicate · +{relationship.possibleDuplicateCount}</Badge>
      ) : null}
    </div>
  );
}

function RelatedEnquiries({
  filters,
  generatedAt,
  lead,
  relationship,
  view,
}: {
  filters: CrmFilters;
  generatedAt: number;
  lead: LeadRow;
  relationship?: CrmRelationshipSummary<LeadRow>;
  view: EnquiryCrmWorkspaceProps["view"];
}) {
  const related = relationship?.relatedLeads ?? [];
  return (
    <section className="rounded-xl border border-mk-blue/15 bg-mk-blue/[0.025] p-4" id="related-enquiries">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Account &amp; contact history</SectionLabel>
          <p className="mt-1 text-sm text-mk-ash">
            {related.length > 0
              ? "Previous and parallel enquiries connected by exact contact or normalized organization."
              : "This is the first captured enquiry for this contact and organization."}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={relationship && relationship.contactEnquiryCount > 1 ? "blue" : "neutral"}>
            {pluralizeCount(relationship?.contactEnquiryCount ?? 1, "contact enquiry", "contact enquiries")}
          </Badge>
          <Badge tone={relationship && relationship.accountEnquiryCount > 1 ? "blue" : "neutral"}>
            {pluralizeCount(
              relationship?.accountEnquiryCount ?? (lead.org.trim() ? 1 : 0),
              "account enquiry",
              "account enquiries",
            )}
          </Badge>
          {relationship?.possibleDuplicateCount ? (
            <Badge tone="amber">{relationship.possibleDuplicateCount} possible duplicate</Badge>
          ) : null}
        </div>
      </div>
      {related.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-mk-ash/15 bg-white">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm" data-related-table>
            <caption className="sr-only">Related enquiries for {lead.name || lead.email}</caption>
            <thead className="bg-mk-paper/90 text-[10px] font-semibold uppercase tracking-[0.11em] text-mk-off-black/55">
              <tr>
                <th className="px-3 py-2.5" scope="col">
                  Received
                </th>
                <th className="px-3 py-2.5" scope="col">
                  Contact
                </th>
                <th className="px-3 py-2.5" scope="col">
                  Request
                </th>
                <th className="px-3 py-2.5" scope="col">
                  Pipeline
                </th>
                <th className="px-3 py-2.5 text-right" scope="col">
                  Record
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mk-ash/12">
              {related.slice(0, 8).map((entry) => {
                const status = normalizeAdminLeadStatus(entry.status);
                return (
                  <tr key={entry.leadId}>
                    <td className="px-3 py-3 text-xs text-mk-ash">
                      <div className="font-medium text-mk-off-black">
                        {formatRelativeAge(entry.createdAt, generatedAt)}
                      </div>
                      {formatDate(entry.createdAt)}
                    </td>
                    <th className="px-3 py-3 font-normal" scope="row">
                      <div className="font-semibold">{entry.name?.trim() || entry.email}</div>
                      <div className="mt-1 text-xs text-mk-ash">{entry.email}</div>
                    </th>
                    <td className="max-w-64 px-3 py-3">
                      <p className="line-clamp-2 text-xs leading-5">{entry.message || "No brief captured"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <a
                        className="font-semibold text-mk-blue hover:underline"
                        href={relationshipRecordHref(view, filters, entry.leadId)}
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function DeliveryPanel({ lead }: { lead: LeadRow }) {
  const channels = [
    ["Owner email", lead.notificationEmailOk],
    ["Team Slack", lead.notificationSlackOk],
    ["ClickUp", lead.notificationClickUpOk],
    ["Visitor confirmation", lead.notificationConfirmationOk],
  ] as const;
  return (
    <section className="rounded-xl border border-mk-ash/15 bg-white p-4">
      <SectionLabel>Delivery</SectionLabel>
      <p className="mt-2 text-sm leading-6 text-mk-off-black">{deliverySummary(lead)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {channels.map(([label, value]) => {
          const state = deliveryChannelState(value);
          return (
            <div className="rounded-lg border border-mk-ash/12 bg-mk-paper/45 p-2.5" key={label}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mk-off-black/55">{label}</div>
              <div className="mt-1">
                <Badge tone={state.tone}>{state.label}</Badge>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3">
        <ClickUpTaskLink lead={lead} />
      </div>
      {lead.notificationSummary ? (
        <details className="mt-3 rounded-lg border border-mk-ash/12 bg-mk-paper/35">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-mk-ash">Provider trace</summary>
          <p className="break-words border-t border-mk-ash/12 px-3 py-2 font-mono text-[11px] leading-5 text-mk-ash">
            {lead.notificationSummary}
          </p>
        </details>
      ) : null}
    </section>
  );
}

function ClickUpTaskLink({ compact = false, lead }: { compact?: boolean; lead: LeadRow }) {
  const href = safeClickUpHref(lead.notificationClickUpTaskUrl, lead.notificationClickUpTaskId);
  if (!href) {
    if (!compact) return null;
    return (
      <div className={`mt-2 text-xs font-semibold ${clickUpTextClass(lead.notificationClickUpOk)}`}>
        {clickUpStatus(lead.notificationClickUpOk)}
      </div>
    );
  }
  return (
    <a
      className={
        compact
          ? "mt-2 inline-flex items-center text-xs font-semibold text-mk-blue hover:underline"
          : "inline-flex h-10 items-center justify-center rounded-lg border border-mk-blue/20 bg-mk-blue/5 px-3 text-sm font-semibold text-mk-blue transition hover:border-mk-blue/40 hover:bg-mk-blue/10"
      }
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      Open ClickUp task <ArrowUpRightIcon className="ml-1.5 size-3.5" />
    </a>
  );
}

function pluralizeCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}
