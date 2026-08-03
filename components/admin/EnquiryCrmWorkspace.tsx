import { ArrowUpRightIcon, Building2Icon, MailIcon, PhoneIcon } from "lucide-react";
import { AdminEnquiryDataTable } from "@/components/admin/AdminEnquiryDataTable";
import { AdminLeadWorkflowForm } from "@/components/admin/AdminLeadWorkflowForm";
import { AdminRunEvalsButton } from "@/components/admin/AdminRunEvalsButton";
import { Badge } from "@/components/admin/Badge";
import {
  buildCrmIntelligence,
  type CrmIntelligence,
  type CrmRelationshipSummary,
  type CrmSort,
  sortCrmLeads,
} from "@/lib/admin-crm";
import type { AdminLeadCounts } from "@/lib/admin-lead-counts";
import {
  adminLeadPriorityLabels,
  adminLeadSlaState,
  adminLeadStatusLabels,
  normalizeAdminLeadPriority,
  normalizeAdminLeadStatus,
} from "@/lib/admin-workflow";
import { getSegment } from "@/lib/segments";
import type { getAdminReviewDashboard } from "@/lib/server/convex";
import { publicLeadUtm } from "@/lib/voice/submission-evidence";

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
  canRunEvals: boolean;
  canUpdateLeads: boolean;
  events: LeadEventRow[];
  filters: CrmFilters;
  generatedAt: number;
  leadCounts: AdminLeadCounts;
  leads: LeadRow[];
  selectedLeadId?: string;
  view: "all" | "today" | "leads";
  voiceSessions: VoiceSessionRow[];
};

export function EnquiryCrmWorkspace({
  allLeads,
  canRunEvals,
  canUpdateLeads,
  events,
  filters,
  generatedAt,
  leadCounts,
  leads,
  selectedLeadId,
  view,
  voiceSessions,
}: EnquiryCrmWorkspaceProps) {
  const intelligence = buildCrmIntelligence(allLeads, generatedAt);
  const ordered = sortCrmLeads(leads, filters.sort, generatedAt);
  const rowLimit = view === "today" && !hasFilters(filters) ? 12 : ordered.length;
  const visible = ordered.slice(0, rowLimit);
  const selected = ordered.find((lead) => lead.leadId === selectedLeadId) ?? visible.find(isActiveLead) ?? visible[0];
  const todayCount = leadCounts.newToday;
  const active = leadCounts.active;
  const unassigned = leadCounts.unassignedActive;
  const important = leadCounts.highPriorityActive;
  const clickUpGaps = leadCounts.clickUpGaps;
  const countsAreLowerBounds = leadCounts.truncated === true;

  return (
    <section className="grid scroll-mt-32 gap-4" id="crm-workspace">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="CRM summary">
        <CrmMetric
          label="New today"
          value={todayCount}
          detail="Saved in Kuala Lumpur today"
          lowerBound={countsAreLowerBounds}
          tone="blue"
        />
        <CrmMetric
          label="Open pipeline"
          value={active}
          detail="Needs an operator outcome"
          lowerBound={countsAreLowerBounds}
          tone="neutral"
        />
        <CrmMetric
          label="Unassigned"
          value={unassigned}
          detail="No accountable owner yet"
          lowerBound={countsAreLowerBounds}
          tone={unassigned ? "amber" : "green"}
        />
        <CrmMetric
          label="High priority"
          value={important}
          detail="High or urgent open work"
          lowerBound={countsAreLowerBounds}
          tone={important ? "amber" : "green"}
        />
        <CrmMetric
          label="ClickUp gaps"
          value={clickUpGaps}
          detail="Enquiries without confirmed ClickUp sync"
          lowerBound={countsAreLowerBounds}
          tone={clickUpGaps ? "red" : "green"}
        />
      </section>

      <CrmIntelligencePanel filters={filters} generatedAt={generatedAt} intelligence={intelligence} view={view} />

      <AdminEnquiryDataTable
        generatedAt={generatedAt}
        initialStatusScope={filters.status || "active"}
        readOnly={!canUpdateLeads}
        rows={ordered.map((lead) => ({
          ...lead,
          // This object crosses the server/client component boundary. Strip
          // server-owned evidence before React serializes table props.
          utm: publicLeadUtm(lead.utm),
          recordHref: recordHref(view, filters, lead.leadId),
        }))}
        totalRows={leadCounts.total}
        totalRowsLowerBound={countsAreLowerBounds}
      />

      {selected ? (
        <CrmRecord
          canRunEvals={canRunEvals}
          canUpdateLeads={canUpdateLeads}
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
  lowerBound = false,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  lowerBound?: boolean;
  tone: "neutral" | "blue" | "green" | "red" | "amber";
}) {
  const toneClass = {
    neutral: "border-white/10 bg-white/[0.04]",
    blue: "border-sky-400/25 bg-sky-400/[0.06]",
    green: "border-emerald-400/25 bg-emerald-700/[0.04]",
    red: "border-rose-400/25 bg-destructive/[0.04]",
    amber: "border-amber-400/25 bg-amber-500/[0.06]",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">{label}</span>
        <span className="text-2xl font-semibold tracking-tight text-slate-100">
          {lowerBound ? "≥" : ""}
          {value}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        {detail}
        {lowerBound ? " · lower bound" : ""}
      </p>
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
    <section className="overflow-hidden rounded-2xl border border-sky-400/25 bg-white/[0.04]" id="crm-intelligence">
      <header className="border-b border-white/10 bg-gradient-to-r from-sky-400/10 via-transparent to-transparent px-4 py-5 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">
              Customer intelligence
            </div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Account portfolio &amp; ownership</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              See organizations as accounts, recognize returning contacts, catch likely duplicate submissions, and
              balance follow-up ownership.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {headlineStats.map((stat) => (
              <div className="min-w-28 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2" key={stat.label}>
                <div className="text-lg font-semibold tracking-tight">{stat.value}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{stat.label}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">{stat.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </header>
      <div className="grid xl:grid-cols-[minmax(0,1.25fr)_minmax(380px,0.75fr)]">
        <section
          className="min-w-0 p-4 sm:p-5 xl:border-r xl:border-white/10"
          aria-labelledby="account-portfolio-title"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold" id="account-portfolio-title">
                Account portfolio
              </h3>
              <p className="mt-1 text-xs text-slate-400">Highest-context organizations, ordered by enquiry history.</p>
            </div>
            <Badge tone="blue">
              {intelligence.accounts.length} {intelligence.accounts.length === 1 ? "account" : "accounts"}
            </Badge>
          </div>
          {intelligence.accounts.length === 0 ? (
            <p className="mt-4 rounded-lg bg-white/[0.04] p-4 text-sm text-slate-400">
              Organization context has not been captured yet.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[660px] border-collapse text-left text-sm" data-account-table>
                <caption className="sr-only">Oriental organization account portfolio</caption>
                <thead className="bg-[#0a0f1c]/85 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">
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
                <tbody className="divide-y divide-white/10">
                  {intelligence.accounts.slice(0, 7).map((account) => (
                    <tr className="bg-white/[0.04] hover:bg-white/[0.02]" key={account.key}>
                      <th className="px-3 py-3 font-normal" scope="row">
                        <a
                          className="font-semibold text-sky-300 hover:underline"
                          href={portfolioHref(view, filters, account.name)}
                        >
                          {account.name}
                        </a>
                        <div className="mt-1 text-xs text-slate-400">
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
                      <td className="px-3 py-3 text-xs text-slate-400">
                        {formatRelativeAge(account.latestAt, generatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="min-w-0 bg-white/[0.02] p-4 sm:p-5" aria-labelledby="owner-workload-title">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold" id="owner-workload-title">
                Owner workload
              </h3>
              <p className="mt-1 text-xs text-slate-400">Open work, priority pressure, and stale follow-up.</p>
            </div>
            <Badge tone={intelligence.ownerWorkloads.some((row) => row.owner === "Unassigned") ? "amber" : "green"}>
              {intelligence.ownerWorkloads.length} queues
            </Badge>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.04]">
            <table className="w-full min-w-[360px] border-collapse text-left text-sm" data-owner-table>
              <caption className="sr-only">Mereka at Oriental enquiry owner workload</caption>
              <thead className="bg-[#0a0f1c]/85 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">
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
              <tbody className="divide-y divide-white/10">
                {intelligence.ownerWorkloads.slice(0, 7).map((row) => (
                  <tr className="bg-white/[0.04]" key={row.owner}>
                    <th className="px-3 py-3 font-normal" scope="row">
                      <a
                        className={
                          row.owner === "Unassigned"
                            ? "font-semibold text-amber-300 hover:underline"
                            : "font-semibold text-sky-300 hover:underline"
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
                      <span className={row.staleCount > 0 ? "font-semibold text-amber-300" : "text-slate-400"}>
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

function CrmRecord({
  canRunEvals,
  canUpdateLeads,
  events,
  filters,
  generatedAt,
  lead,
  relationship,
  view,
  voiceSession,
}: {
  canRunEvals: boolean;
  canUpdateLeads: boolean;
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
      className="scroll-mt-28 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
      id="crm-record"
    >
      <header className="border-b border-white/10 bg-gradient-to-r from-sky-400/10 via-transparent to-transparent px-4 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.13em] text-sky-300">Enquiry record</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{lead.name?.trim() || "Unnamed visitor"}</h2>
            <p className="mt-1 text-sm text-slate-400">{lead.org?.trim() || "Organisation not captured"}</p>
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
              className="inline-flex h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-900 transition hover:bg-white/[0.06]"
              href={`mailto:${encodeURIComponent(lead.email)}`}
            >
              <MailIcon className="mr-2 size-4" /> Email
            </a>
            {lead.phone ? (
              <a
                className="inline-flex h-10 items-center rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold transition hover:border-sky-400/40"
                href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}
              >
                <PhoneIcon className="mr-2 size-4" /> Call
              </a>
            ) : null}
            {website ? (
              <a
                className="inline-flex h-10 items-center rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold transition hover:border-sky-400/40"
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
        <div className="grid content-start gap-5 p-4 sm:p-6 xl:border-r xl:border-white/10">
          <section>
            <SectionLabel>What they want</SectionLabel>
            <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-100">
              {lead.message?.trim() || "No request brief was captured for this enquiry."}
            </p>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
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
            <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4">
              <SectionLabel>Latest workflow note</SectionLabel>
              <p className="mt-2 text-sm leading-6">{lead.workflowNote}</p>
            </section>
          ) : null}

          <InteractionEvidence canRunEvals={canRunEvals} lead={lead} voiceSession={voiceSession} />

          {lead.transcript.length > 0 ? (
            <details className="rounded-xl border border-white/10 bg-white/[0.04]" suppressHydrationWarning>
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
                Conversation transcript · {lead.transcript.length} turns
              </summary>
              <div className="grid gap-2 border-t border-white/10 p-4">
                {lead.transcript.map((turn: { role: string; text: string }) => {
                  const isReka = turn.role === "assistant";
                  return (
                    <div
                      className={isReka ? "flex justify-end" : "flex justify-start"}
                      key={`${turn.role}:${turn.text}`}
                    >
                      <div
                        className={
                          isReka
                            ? "max-w-[88%] rounded-2xl rounded-br-sm border border-sky-400/20 bg-sky-400/10 px-3 py-2"
                            : "max-w-[88%] rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.05] px-3 py-2"
                        }
                      >
                        <div
                          className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${isReka ? "text-sky-300" : "text-slate-500"}`}
                        >
                          {isReka ? "Reka" : "Visitor"}
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm leading-6 text-slate-300">{turn.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}

          {Object.keys(publicLeadUtm(lead.utm)).length > 0 ? (
            <section>
              <SectionLabel>Acquisition metadata</SectionLabel>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(publicLeadUtm(lead.utm)).map(([key, value]) => (
                  <Badge key={key} tone="neutral">
                    {key}: {String(value)}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="grid content-start gap-5 bg-white/[0.02] p-4 sm:p-6">
          <section>
            <SectionLabel>Next action</SectionLabel>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-100">
              {lead.nextActionNote?.trim() || leadActionHint(lead)}
            </p>
            {lead.nextActionAt ? (
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Due {formatDate(lead.nextActionAt)} · {sla.label}
              </p>
            ) : null}
            {canUpdateLeads ? (
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
            ) : (
              <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-400">
                Workflow editing requires review-token step-up.
              </p>
            )}
          </section>

          <DeliveryPanel lead={lead} />

          <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <SectionLabel>Activity</SectionLabel>
            <div className="mt-3 grid gap-3">
              {orderedEvents.length === 0 ? (
                <p className="text-sm leading-6 text-slate-400">No workflow activity has been recorded yet.</p>
              ) : (
                orderedEvents.slice(0, 8).map((event) => (
                  <div
                    className="grid grid-cols-[8px_minmax(0,1fr)] gap-3"
                    key={`${event.kind}:${event.createdAt}:${event.leadId}`}
                  >
                    <span className="mt-1.5 size-2 rounded-full bg-sky-400" />
                    <div>
                      <div className="text-sm font-semibold">{eventLabel(event.kind)}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {event.actor} · {formatDate(event.createdAt)}
                      </div>
                      {event.note ? <p className="mt-1 text-xs leading-5 text-slate-400">{event.note}</p> : null}
                      {event.reason && event.reason !== event.note ? (
                        <p className="mt-1 text-xs leading-5 text-slate-400">Reason: {event.reason}</p>
                      ) : null}
                      {event.changes?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {event.changes.map((change: { field: string; before?: string; after?: string }) => (
                            <span
                              className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-semibold text-slate-400"
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

      <div className="border-t border-white/10 p-4 sm:p-6">
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

function InteractionEvidence({
  canRunEvals,
  lead,
  voiceSession,
}: {
  canRunEvals: boolean;
  lead: LeadRow;
  voiceSession?: VoiceSessionRow;
}) {
  if (lead.source !== "voice") return null;
  const evaluation = voiceSession?.eval;
  if (!evaluation) {
    return (
      <section className="rounded-xl border border-amber-400/25 bg-amber-500/[0.07] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Reka interaction evaluation</SectionLabel>
          <Badge tone="amber">Pending</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-amber-200/75">
          The enquiry is safely stored. A 1–5 evaluation has not been persisted for this interaction yet.
        </p>
        {lead.voiceReviewId && canRunEvals ? (
          <div className="mt-3">
            <AdminRunEvalsButton compact reviewIds={[lead.voiceReviewId]}>
              Evaluate this conversation
            </AdminRunEvalsButton>
          </div>
        ) : null}
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
    <section className="rounded-xl border border-sky-400/25 bg-sky-400/[0.05] p-4" aria-label="Interaction evaluation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Reka interaction evaluation</SectionLabel>
        <Badge tone={evaluation.droppedMidTurn ? "red" : "green"}>
          {evaluation.droppedMidTurn ? "Dropped mid-turn" : "Completed"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {scores.map(([label, value, invert]) => (
          <div
            className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
            data-eval-dimension={label.toLowerCase()}
            key={label}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">{label}</div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xl font-semibold">{value}/5</span>
              <Badge tone={scoreTone(value, invert)}>{scoreVerdict(value, invert)}</Badge>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        Higher is better for routing, capture, and quality. Lower is better for frustration.
      </p>
      {evaluation.summary ? <p className="mt-2 text-sm leading-6">{evaluation.summary}</p> : null}
    </section>
  );
}

function DataField({ icon, label, value }: { icon?: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className={`mt-1 break-words text-sm ${value?.trim() ? "text-slate-100" : "italic text-slate-400"}`}>
        {value?.trim() || "Not captured"}
      </dd>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">{children}</div>;
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
  if (value === true) return "text-emerald-300";
  if (value === false) return "text-rose-300";
  return "text-amber-300";
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

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
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
    <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-4" id="related-enquiries">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionLabel>Account &amp; contact history</SectionLabel>
          <p className="mt-1 text-sm text-slate-400">
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
        <div className="mt-4 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.04]">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm" data-related-table>
            <caption className="sr-only">Related enquiries for {lead.name || lead.email}</caption>
            <thead className="bg-[#0a0f1c]/85 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">
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
            <tbody className="divide-y divide-white/10">
              {related.slice(0, 8).map((entry) => {
                const status = normalizeAdminLeadStatus(entry.status);
                return (
                  <tr key={entry.leadId}>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      <div className="font-medium text-slate-100">
                        {formatRelativeAge(entry.createdAt, generatedAt)}
                      </div>
                      {formatDate(entry.createdAt)}
                    </td>
                    <th className="px-3 py-3 font-normal" scope="row">
                      <div className="font-semibold">{entry.name?.trim() || entry.email}</div>
                      <div className="mt-1 text-xs text-slate-400">{entry.email}</div>
                    </th>
                    <td className="max-w-64 px-3 py-3">
                      <p className="line-clamp-2 text-xs leading-5">{entry.message || "No brief captured"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <a
                        className="font-semibold text-sky-300 hover:underline"
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
    <section className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <SectionLabel>Delivery</SectionLabel>
      <p className="mt-2 text-sm leading-6 text-slate-100">{deliverySummary(lead)}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {channels.map(([label, value]) => {
          const state = deliveryChannelState(value);
          return (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5" key={label}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</div>
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
        <details className="mt-3 rounded-lg border border-white/10 bg-white/[0.02]">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-400">Provider trace</summary>
          <p className="break-words border-t border-white/10 px-3 py-2 font-mono text-[11px] leading-5 text-slate-400">
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
          ? "mt-2 inline-flex items-center text-xs font-semibold text-sky-300 hover:underline"
          : "inline-flex h-10 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-400/10 px-3 text-sm font-semibold text-sky-300 transition hover:border-sky-400/40 hover:bg-sky-400/10"
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
