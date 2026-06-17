import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AdminAutoRefresh } from "@/components/admin/AdminAutoRefresh";
import { AdminLeadWorkflowForm } from "@/components/admin/AdminLeadWorkflowForm";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { AdminVoiceFollowUpButton } from "@/components/admin/AdminVoiceFollowUpButton";
import { Badge } from "@/components/admin/Badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  adminLeadPriorityLabels,
  adminLeadStatusLabels,
  normalizeAdminLeadPriority,
  normalizeAdminLeadStatus,
} from "@/lib/admin-workflow";
import { getSegment } from "@/lib/segments";
import { adminCookieName, verifyAdminSessionCookie } from "@/lib/server/admin-auth";
import { getAdminReviewDashboard } from "@/lib/server/convex";
import { isBenignVoiceError, type VoiceRuntimeError } from "@/lib/voice/realtime-events";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin Console | Oriental Admin",
  robots: { index: false, follow: false },
};

type DashboardResult = Awaited<ReturnType<typeof getAdminReviewDashboard>>;
type DashboardData = Extract<DashboardResult, { ok: true }>["data"];
type LeadRow = DashboardData["leads"][number];
type VoiceSessionRow = DashboardData["voiceSessions"][number];
type LeadEventRow = DashboardData["leadEvents"][number];

export default async function SessionReviewPage() {
  const cookieStore = await cookies();
  const auth = verifyAdminSessionCookie(cookieStore.get(adminCookieName)?.value);
  if (!auth.ok) return <AdminLoginForm reason={auth.reason} />;

  const dashboard = await getAdminReviewDashboard(75).catch(() => ({ ok: false as const, reason: "convex_failed" }));
  if (!dashboard.ok) {
    return (
      <AdminShell>
        <StatusPanel
          title="Dashboard unavailable"
          detail={`Convex review data could not be loaded: ${dashboard.reason}`}
        />
      </AdminShell>
    );
  }

  const sessionsWithRealErrors = dashboard.data.voiceSessions.filter((session: VoiceSessionRow) =>
    session.errors.some((error: VoiceRuntimeError) => !isBenignVoiceError(error)),
  ).length;

  return (
    <AdminShell generatedAt={dashboard.data.generatedAt}>
      <ActionQueuePanel data={dashboard.data} sessionsWithRealErrors={sessionsWithRealErrors} />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Recent leads" value={dashboard.data.metrics.recentLeads} />
        <MetricCard
          detail={`${countUnassignedActiveLeads(dashboard.data.leads)} unassigned`}
          label="Active queue"
          value={dashboard.data.metrics.activeLeads}
        />
        <MetricCard label="High priority" tone="danger" value={dashboard.data.metrics.urgentLeads} />
        <MetricCard label="Notification health" suffix="%" value={dashboard.data.metrics.notificationDeliveryRate} />
        <MetricCard label="Voice submit rate" suffix="%" value={dashboard.data.metrics.voiceSubmitRate} />
        <MetricCard
          detail={`${recoverableVoiceSessions(dashboard.data.voiceSessions).length} recoverable`}
          label="Sessions with errors"
          tone="danger"
          value={sessionsWithRealErrors}
        />
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <AnalyticsPanel data={dashboard.data} />
        <WorkflowPanel leads={dashboard.data.leads} />
      </section>

      <section className="grid gap-5 xl:grid-cols-4">
        <TriagePanel leads={dashboard.data.queues.triage} />
        <RecoverableVoicePanel sessions={dashboard.data.voiceSessions} />
        <PriorityPanel leads={dashboard.data.queues.highPriority} />
        <NotificationPanel leads={dashboard.data.queues.failedNotifications} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.65fr)]">
        <VoiceSessionsPanel sessions={dashboard.data.voiceSessions} />
        <EventsPanel events={dashboard.data.leadEvents} />
      </section>
    </AdminShell>
  );
}

function AdminShell({ children, generatedAt }: { children: ReactNode; generatedAt?: number }) {
  return (
    <main className="min-h-svh bg-mk-paper px-4 py-8 text-mk-off-black sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-6">
        <header className="flex flex-col gap-4 border-b border-mk-ash/20 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mk-blue">Oriental Admin</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Operations console</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-mk-ash">
              Triage partner handoffs, track conversion health, inspect voice QA, and leave an audit trail for
              follow-up.
            </p>
            {generatedAt ? <p className="mt-2 text-xs text-mk-ash">Fresh as of {formatDate(generatedAt)}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <AdminAutoRefresh />
            <form action="/api/admin/logout" method="post">
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  suffix = "",
  tone = "default",
  detail,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "default" | "danger";
  detail?: string;
}) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={tone === "danger" && value > 0 ? "text-destructive" : undefined}>
          {value}
          {suffix}
        </CardTitle>
        {detail ? <p className="text-xs text-mk-ash">{detail}</p> : null}
      </CardHeader>
    </Card>
  );
}

function WorkflowPanel({ leads }: { leads: LeadRow[] }) {
  const ordered = [...leads].sort(
    (left, right) => priorityRank(right) - priorityRank(left) || right.createdAt - left.createdAt,
  );
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id="workflow">
      <CardHeader>
        <CardTitle>Lead workflow</CardTitle>
        <CardDescription>
          Update status, priority, owner, and next-action notes without leaving the queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {ordered.length === 0 ? <EmptyState label="No leads saved yet." /> : null}
        {ordered.map((lead) => (
          <WorkflowLeadCard key={lead.leadId} lead={lead} />
        ))}
      </CardContent>
    </Card>
  );
}

function AnalyticsPanel({ data }: { data: DashboardData }) {
  const maxDaily = Math.max(...data.analytics.dailyLeads.map((day) => day.count), 1);
  const voiceRealErrors = data.voiceSessions.filter((session: VoiceSessionRow) =>
    session.errors.some((error: VoiceRuntimeError) => !isBenignVoiceError(error)),
  ).length;
  const recoverableCount = data.voiceSessions.filter(
    (session: VoiceSessionRow) => !session.leadId && session.captured.email.trim().length > 0 && !session.followedUpAt,
  ).length;
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>Analytics</CardTitle>
        <CardDescription>
          Recent acquisition mix, workflow state, notification health, and voice funnel quality.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          <CountList title="Status" values={data.analytics.statusCounts} />
          <CountList title="Source" values={data.analytics.sourceCounts} />
          <CountList title="Priority" values={data.analytics.priorityCounts} />
          <CountList title="Segment" values={data.analytics.segmentCounts} />
          <CountList
            title="Voice variants"
            values={countByVoiceSessions(data.voiceSessions, (session) => session.variant || "default")}
          />
          <CountList
            title="Realtime voices"
            values={countByVoiceSessions(data.voiceSessions, (session) => session.voice || "unknown")}
          />
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">7-day leads</div>
          <div className="grid grid-cols-7 items-end gap-2 rounded-lg bg-mk-paper p-3">
            {data.analytics.dailyLeads.map((day) => (
              <div className="grid gap-2 text-center text-[11px] text-mk-ash" key={day.date}>
                <div className="flex h-24 items-end rounded bg-white">
                  <div
                    aria-label={`${day.count} leads on ${day.date}`}
                    className="w-full rounded bg-mk-blue/80"
                    role="img"
                    style={{ height: `${Math.max((day.count / maxDaily) * 100, day.count > 0 ? 8 : 2)}%` }}
                  />
                </div>
                <span>{day.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <HealthBox
            label="Notifications"
            value={`${data.metrics.notificationDeliveryRate}%`}
            detail={`${data.analytics.notification.delivered} delivered · ${data.analytics.notification.failed} failed · ${data.analytics.notification.pending} pending`}
            danger={data.analytics.notification.failed > 0}
          />
          <HealthBox
            label="Voice funnel"
            value={`${data.metrics.voiceSubmitRate}%`}
            detail={`${data.analytics.voice.submitted}/${data.analytics.voice.sessions} submitted · ${recoverableCount} recoverable · ${voiceRealErrors} with errors · ${data.analytics.voice.totalResponseTokens} response tokens`}
            danger={voiceRealErrors > 0}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowLeadCard({ lead }: { lead: LeadRow }) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  const notification = notificationStatus(lead);
  return (
    <article className="scroll-mt-6 rounded-lg border border-mk-ash/15 bg-mk-paper/60 p-4" id={leadAnchorId(lead)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{lead.name || "Unnamed"}</div>
          <div className="mt-1 text-xs text-mk-ash">
            {lead.email} · {lead.org || "No organisation"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={lead.source === "voice" ? "blue" : "neutral"}>{lead.source}</Badge>
          <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
          <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
          <Badge tone={notification.tone}>{notification.label}</Badge>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 text-xs text-mk-ash sm:grid-cols-4">
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Route</dt>
          <dd>{lead.routedTo}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Owner email</dt>
          <dd className="break-all">{lead.routedToEmail || "n/a"}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Created</dt>
          <dd>{formatDate(lead.createdAt)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Last reviewed</dt>
          <dd>{lead.lastReviewedAt ? formatDate(lead.lastReviewedAt) : "Not yet"}</dd>
        </div>
      </dl>
      <LeadContactChips lead={lead} />
      <p className="mt-4 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-6">{lead.message}</p>
      {lead.workflowNote ? (
        <p className="mt-3 rounded-lg bg-mk-horizon/15 p-3 text-xs text-mk-ash">{lead.workflowNote}</p>
      ) : null}
      <AdminLeadWorkflowForm
        leadId={lead.leadId}
        initialOwner={lead.owner}
        initialPriority={priority}
        initialStatus={status}
      />
      {lead.transcript.length > 0 ? <TranscriptLog transcript={lead.transcript} /> : null}
    </article>
  );
}

function LeadContactChips({ lead }: { lead: LeadRow }) {
  const chips = [
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.website ? `Web: ${lead.website}` : null,
    Object.keys(lead.utm ?? {}).length > 0 ? `UTM: ${Object.keys(lead.utm).join(", ")}` : null,
  ].filter(Boolean);
  if (chips.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Badge key={chip} tone="neutral">
          {chip}
        </Badge>
      ))}
    </div>
  );
}

function TriagePanel({ leads }: { leads: LeadRow[] }) {
  return (
    <QueuePanel
      description="New and reviewing handoffs that need owner, priority, or next-action decisions."
      emptyLabel="No triage leads in the recent window."
      id="triage"
      leads={leads}
      title="Needs review"
    />
  );
}

function PriorityPanel({ leads }: { leads: LeadRow[] }) {
  return (
    <QueuePanel
      description="High and urgent handoffs that should get human ownership first."
      emptyLabel="No high-priority handoffs in the recent window."
      id="priority"
      leads={leads}
      title="Priority queue"
    />
  );
}

function NotificationPanel({ leads }: { leads: LeadRow[] }) {
  return (
    <QueuePanel
      description="Leads where configured delivery paths definitely failed after a send attempt."
      emptyLabel="No confirmed notification failures in the recent window."
      id="notifications"
      leads={leads}
      title="Notification recovery"
    />
  );
}

function QueuePanel({
  description,
  emptyLabel,
  id,
  leads,
  title,
}: {
  description: string;
  emptyLabel: string;
  id: string;
  leads: LeadRow[];
  title: string;
}) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id={id}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {leads.length === 0 ? <EmptyState label={emptyLabel} /> : null}
        {leads.map((lead) => {
          const priority = normalizeAdminLeadPriority(lead.priority);
          const status = normalizeAdminLeadStatus(lead.status);
          const notification = notificationStatus(lead);
          return (
            <a
              className="block rounded-lg border border-mk-ash/15 p-3 transition hover:border-mk-blue/40 hover:bg-mk-paper/70"
              href={`#${leadAnchorId(lead)}`}
              key={`${title}:${lead.leadId}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{lead.name || "Unnamed"}</div>
                  <div className="mt-1 text-xs text-mk-ash">{lead.email}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
                  <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
                  <Badge tone={notification.tone}>{notification.label}</Badge>
                </div>
              </div>
              <div className="mt-3 text-xs text-mk-ash">
                {lead.routedTo} · {lead.owner || "Unassigned"} · {formatDate(lead.createdAt)}
              </div>
              {lead.notificationSummary ? (
                <p className="mt-2 text-xs text-destructive">{lead.notificationSummary}</p>
              ) : null}
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-mk-blue">
                Open workflow
              </div>
            </a>
          );
        })}
      </CardContent>
    </Card>
  );
}

function EventsPanel({ events }: { events: LeadEventRow[] }) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
        <CardDescription>Recent system and admin events written beside lead records.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {events.length === 0 ? <EmptyState label="No lead events yet." /> : null}
        {events.map((event) => (
          <article
            className="rounded-lg border border-mk-ash/15 p-3"
            key={`${event.leadId}:${event.createdAt}:${event.kind}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{event.kind.replaceAll("_", " ")}</div>
              <Badge tone={event.actor === "admin" ? "blue" : "neutral"}>{event.actor ?? "system"}</Badge>
            </div>
            <div className="mt-1 break-all text-xs text-mk-ash">{event.leadId}</div>
            {event.fromStatus || event.toStatus ? (
              <div className="mt-2 text-xs text-mk-ash">
                {event.fromStatus ?? "n/a"} {"->"} {event.toStatus ?? "n/a"}
              </div>
            ) : null}
            {event.note ? <p className="mt-2 text-sm leading-6">{event.note}</p> : null}
            <div className="mt-2 text-xs text-mk-ash">{formatDate(event.createdAt)}</div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function CountList({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values).sort((left, right) => right[1] - left[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="rounded-lg border border-mk-ash/15 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">{title}</div>
      <div className="grid gap-2">
        {entries.length === 0 ? <div className="text-xs text-mk-ash">No data</div> : null}
        {entries.slice(0, 6).map(([label, count]) => (
          <div className="grid gap-1" key={`${title}:${label}`}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="capitalize text-mk-ash">{label.replaceAll("-", " ")}</span>
              <span className="font-semibold">{count}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-mk-paper">
              <div
                className="h-full rounded-full bg-mk-blue"
                style={{ width: `${total ? (count / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthBox({
  label,
  value,
  detail,
  danger,
}: {
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-mk-ash/15 bg-mk-paper p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">{label}</div>
      <div className={danger ? "mt-2 text-2xl font-semibold text-destructive" : "mt-2 text-2xl font-semibold"}>
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-mk-ash">{detail}</div>
    </div>
  );
}

function countByVoiceSessions(sessions: VoiceSessionRow[], key: (session: VoiceSessionRow) => string) {
  return sessions.reduce<Record<string, number>>((counts, session) => {
    const value = key(session);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function priorityRank(lead: LeadRow) {
  const priority = normalizeAdminLeadPriority(lead.priority);
  return { low: 0, normal: 1, high: 2, urgent: 3 }[priority];
}

function statusTone(status: ReturnType<typeof normalizeAdminLeadStatus>) {
  if (status === "qualified") return "green";
  if (status === "contacted") return "blue";
  if (status === "reviewing") return "amber";
  if (status === "archived") return "neutral";
  return "red";
}

function priorityTone(priority: ReturnType<typeof normalizeAdminLeadPriority>) {
  if (priority === "urgent" || priority === "high") return "amber";
  if (priority === "low") return "neutral";
  return "blue";
}

function notificationStatus(lead: LeadRow): { label: string; tone: "neutral" | "blue" | "green" | "red" | "amber" } {
  if (lead.notificationDelivered === true) return { label: "notified", tone: "green" };
  if (lead.notificationDelivered === false) return { label: "notify failed", tone: "red" };
  return { label: "notify pending", tone: "neutral" };
}

function leadAnchorId(lead: LeadRow) {
  return `lead-${lead.leadId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function ActionQueuePanel({ data, sessionsWithRealErrors }: { data: DashboardData; sessionsWithRealErrors: number }) {
  const recoverable = recoverableVoiceSessions(data.voiceSessions).length;
  const staleActive = staleActiveLeads(data.leads, data.generatedAt).length;
  const unassigned = countUnassignedActiveLeads(data.leads);
  const cards = [
    {
      label: "Voice recovery",
      value: recoverable,
      detail: "Captured email but no submitted handoff.",
      href: "#voice-recovery",
      tone: recoverable > 0 ? "amber" : "green",
    },
    {
      label: "Realtime QA",
      value: sessionsWithRealErrors,
      detail: "Sessions with non-benign Realtime errors.",
      href: "#voice-sessions",
      tone: sessionsWithRealErrors > 0 ? "red" : "green",
    },
    {
      label: "Failed notifications",
      value: data.queues.failedNotifications.length,
      detail: "Handoffs needing manual delivery checks.",
      href: "#notifications",
      tone: data.queues.failedNotifications.length > 0 ? "red" : "green",
    },
    {
      label: "Unassigned active",
      value: unassigned,
      detail: "Open leads without an owner.",
      href: "#triage",
      tone: unassigned > 0 ? "amber" : "green",
    },
    {
      label: "Stale active",
      value: staleActive,
      detail: "Open leads untouched for more than 48 hours.",
      href: "#triage",
      tone: staleActive > 0 ? "amber" : "green",
    },
  ] as const;

  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Operator queue ordered by recoverability, risk, and handoff freshness.</CardDescription>
          </div>
          <Badge tone={data.metrics.activeLeads > 0 ? "amber" : "green"}>
            {data.metrics.activeLeads > 0 ? "open work" : "clear"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <a
            className="group rounded-lg border border-mk-ash/15 bg-mk-paper/60 p-3 transition hover:border-mk-blue/40 hover:bg-white"
            href={card.href}
            key={card.label}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
                {card.label}
              </span>
              <Badge tone={card.tone}>{card.value}</Badge>
            </div>
            <p className="mt-3 text-xs leading-5 text-mk-ash">{card.detail}</p>
          </a>
        ))}
      </CardContent>
    </Card>
  );
}

function RecoverableVoicePanel({ sessions }: { sessions: VoiceSessionRow[] }) {
  const unsent = sessions.filter((session) => !session.leadId && session.captured.email.trim().length > 0);
  const recoverable = unsent.filter((session) => !session.followedUpAt);
  const followedUp = unsent.filter((session) => Boolean(session.followedUpAt));
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id="voice-recovery">
      <CardHeader>
        <CardTitle>Recoverable voice leads</CardTitle>
        <CardDescription>
          Visitors who shared contact details with Reka but never sent the handoff. Follow up before they go cold.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {recoverable.length === 0 ? <EmptyState label="No unsent voice sessions waiting for follow-up." /> : null}
        {recoverable.map((session) => {
          const owner = getSegment(session.segment).routedTo.name;
          return (
            <article className="rounded-lg border border-mk-ash/15 p-3" key={session.reviewId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{session.captured.name || "Unnamed visitor"}</div>
                  <div className="mt-1 break-all text-xs text-mk-ash">
                    {session.captured.email}
                    {session.captured.org ? ` · ${session.captured.org}` : ""}
                  </div>
                </div>
                <Badge tone="amber">unsent</Badge>
              </div>
              <div className="mt-3 text-xs text-mk-ash">
                {owner} · {session.segment} · {formatDate(session.updatedAt)}
              </div>
              {session.captured.message ? (
                <p className="mt-2 line-clamp-3 text-sm leading-6">{session.captured.message}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  className="inline-flex h-8 items-center rounded-full bg-mk-off-black px-4 text-xs font-semibold text-white transition hover:bg-mk-blue"
                  href={followUpMailto(session)}
                >
                  Follow up by email
                </a>
                <AdminVoiceFollowUpButton markAs={true} reviewId={session.reviewId}>
                  Mark followed up
                </AdminVoiceFollowUpButton>
              </div>
            </article>
          );
        })}
        {followedUp.length > 0 ? (
          <div className="rounded-lg border border-mk-ash/15 bg-mk-paper/60 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
              Followed up
            </div>
            <div className="mt-2 grid gap-2">
              {followedUp.map((session) => (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs" key={session.reviewId}>
                  <span className="break-all text-mk-ash">
                    {session.captured.name || "Unnamed visitor"} · {session.captured.email}
                    {session.followedUpAt ? ` · ${formatDate(session.followedUpAt)}` : ""}
                  </span>
                  <AdminVoiceFollowUpButton markAs={false} reviewId={session.reviewId} variant="ghost">
                    Undo
                  </AdminVoiceFollowUpButton>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function followUpMailto(session: VoiceSessionRow) {
  const subject = encodeURIComponent("Following up on your Oriental enquiry");
  const greeting = session.captured.name ? `Hi ${session.captured.name},` : "Hi,";
  const body = encodeURIComponent(
    `${greeting}\n\nThanks for talking with Reka about Oriental. Picking up where that conversation left off —\n\n`,
  );
  return `mailto:${encodeURIComponent(session.captured.email)}?subject=${subject}&body=${body}`;
}

function VoiceSessionsPanel({ sessions }: { sessions: VoiceSessionRow[] }) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id="voice-sessions">
      <CardHeader>
        <CardTitle>Voice sessions</CardTitle>
        <CardDescription>
          Realtime snapshots for QA, debugging, cost review, and handoff completion checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <VoiceQaRollup sessions={sessions} />
        {sessions.length === 0 ? <EmptyState label="No voice review snapshots yet." /> : null}
        {sessions.map((session) => {
          const realErrorCount = session.errors.filter((error: VoiceRuntimeError) => !isBenignVoiceError(error)).length;
          const benignErrorCount = session.errors.length - realErrorCount;
          return (
            <article className="rounded-lg border border-mk-ash/15 p-4" key={session.reviewId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{session.captured.name || "Uncaptured visitor"}</div>
                  <div className="mt-1 text-xs text-mk-ash">
                    {session.segment} · updated {formatDate(session.updatedAt)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={session.leadId ? "green" : "neutral"}>
                    {session.leadId ? "submitted" : session.status}
                  </Badge>
                  {session.variant ? <Badge tone="blue">{session.variant}</Badge> : null}
                  {session.routeRequested ? <Badge tone="amber">route requested</Badge> : null}
                  <Badge tone={realErrorCount > 0 ? "red" : "blue"}>
                    {realErrorCount > 0
                      ? `${realErrorCount} errors`
                      : benignErrorCount > 0
                        ? `${benignErrorCount} benign`
                        : "0 errors"}
                  </Badge>
                </div>
              </div>
              <dl className="mt-4 grid gap-2 text-xs text-mk-ash sm:grid-cols-4">
                <div>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Session</dt>
                  <dd className="break-all">{session.sessionId}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Model</dt>
                  <dd>
                    {[session.model, session.voice, session.speed ? `${session.speed}x` : null]
                      .filter(Boolean)
                      .join(" · ") || "n/a"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Variant</dt>
                  <dd>{session.variant || "default"}</dd>
                </div>
                <div>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Runtime</dt>
                  <dd>{session.connectionStatus}</dd>
                </div>
              </dl>
              <SessionQualityFlags session={session} realErrorCount={realErrorCount} />
              <div className="mt-4 grid gap-3 rounded-lg bg-mk-paper p-3 text-sm leading-6">
                <div>
                  <span className="font-semibold">Email:</span> {session.captured.email || "empty"}
                </div>
                <div>
                  <span className="font-semibold">Organisation:</span> {session.captured.org || "empty"}
                </div>
                {session.captured.phone ? (
                  <div>
                    <span className="font-semibold">Phone:</span> {session.captured.phone}
                  </div>
                ) : null}
                {session.captured.website ? (
                  <div>
                    <span className="font-semibold">Website / Socials:</span> {session.captured.website}
                  </div>
                ) : null}
                <div>
                  <span className="font-semibold">Brief:</span> {session.captured.message || "empty"}
                </div>
              </div>
              <UsageSummary session={session} />
              {session.errors.length > 0 ? (
                <div
                  className={
                    realErrorCount > 0
                      ? "mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs"
                      : "mt-3 rounded-lg border border-mk-ash/15 bg-mk-paper p-3 text-xs"
                  }
                >
                  {session.errors.map((error: VoiceRuntimeError) => (
                    <div
                      className={isBenignVoiceError(error) ? "text-mk-ash" : "text-destructive"}
                      key={`${error.eventId ?? "error"}:${error.message}`}
                    >
                      {error.code ? <span className="font-semibold">{error.code}: </span> : null}
                      {error.message}
                      {isBenignVoiceError(error) ? " (benign)" : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              {session.transcript.length > 0 ? <TranscriptLog transcript={session.transcript} /> : null}
            </article>
          );
        })}
      </CardContent>
    </Card>
  );
}

function UsageSummary({ session }: { session: VoiceSessionRow }) {
  if (!session.usage) return null;
  return (
    <div className="mt-3 grid gap-2 text-xs text-mk-ash sm:grid-cols-3 lg:grid-cols-6">
      <div>Responses: {session.usage.responseCount}</div>
      <div>Response tokens: {session.usage.responseTokens}</div>
      <div>Input: {session.usage.responseInputTokens}</div>
      <div>Output: {session.usage.responseOutputTokens}</div>
      <div>Cached: {session.usage.responseCachedTokens}</div>
      <div>Transcriptions: {session.usage.transcriptionCount}</div>
    </div>
  );
}

function VoiceQaRollup({ sessions }: { sessions: VoiceSessionRow[] }) {
  if (sessions.length === 0) return null;
  const variantRows = summarizeVoiceVariants(sessions);
  return (
    <div className="grid gap-3 rounded-lg border border-mk-ash/15 bg-mk-paper/70 p-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">QA summary</div>
        <div className="mt-3 grid gap-2 text-xs text-mk-ash sm:grid-cols-2 lg:grid-cols-1">
          <div>{sessions.length} snapshots reviewed</div>
          <div>{sessions.filter((session) => Boolean(session.leadId)).length} submitted handoffs</div>
          <div>{recoverableVoiceSessions(sessions).length} recoverable unsent leads</div>
          <div>{sessions.filter((session) => session.routeRequested).length} route requests</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-mk-off-black/55">
            <tr className="border-b border-mk-ash/15">
              <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Variant</th>
              <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Voice</th>
              <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Sessions</th>
              <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Submit</th>
              <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Errors</th>
              <th className="py-2 font-semibold uppercase tracking-[0.12em]">Tokens</th>
            </tr>
          </thead>
          <tbody className="text-mk-ash">
            {variantRows.map((row) => (
              <tr className="border-b border-mk-ash/10 last:border-0" key={`${row.variant}:${row.voice}`}>
                <td className="py-2 pr-3 font-medium text-mk-off-black">{row.variant}</td>
                <td className="py-2 pr-3">{row.voice}</td>
                <td className="py-2 pr-3">{row.sessions}</td>
                <td className="py-2 pr-3">{row.submitRate}%</td>
                <td className={row.errorSessions > 0 ? "py-2 pr-3 text-destructive" : "py-2 pr-3"}>
                  {row.errorSessions}
                </td>
                <td className="py-2">{row.responseTokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionQualityFlags({ session, realErrorCount }: { session: VoiceSessionRow; realErrorCount: number }) {
  const captured = capturedFieldCount(session.captured);
  const roles = countTranscriptRoles(session.transcript);
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Badge tone={captured >= 4 ? "green" : captured >= 2 ? "amber" : "red"}>{captured}/6 captured</Badge>
      <Badge tone={session.transcript.length > 0 ? "blue" : "red"}>{session.transcript.length} turns</Badge>
      <Badge tone={roles.assistant > 0 ? "neutral" : "amber"}>
        {roles.user}/{roles.assistant} visitor/reka
      </Badge>
      {realErrorCount > 0 ? <Badge tone="red">review error</Badge> : null}
      {!session.leadId && session.captured.email.trim().length > 0 ? <Badge tone="amber">recoverable</Badge> : null}
    </div>
  );
}

function TranscriptLog({ transcript }: { transcript: Array<{ role: string; text: string }> }) {
  return (
    <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-mk-ash/15 bg-white p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mk-ash">Transcript</div>
      <div className="grid gap-2">
        {transcript.map((entry) => (
          <p className="text-xs leading-5 text-mk-ash" key={`${entry.role}:${entry.text.slice(0, 120)}`}>
            <span className="font-semibold text-mk-off-black">{entry.role === "assistant" ? "Reka" : "Visitor"}:</span>{" "}
            {entry.text}
          </p>
        ))}
      </div>
    </div>
  );
}

function StatusPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <Card className="border-destructive/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle className="text-destructive">{title}</CardTitle>
        <CardDescription>{detail}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-mk-ash/25 p-6 text-center text-sm text-mk-ash">{label}</div>
  );
}

function recoverableVoiceSessions(sessions: VoiceSessionRow[]) {
  return sessions.filter(
    (session) => !session.leadId && session.captured.email.trim().length > 0 && !session.followedUpAt,
  );
}

function countUnassignedActiveLeads(leads: LeadRow[]) {
  return leads.filter((lead) => isActiveLead(lead) && !lead.owner?.trim()).length;
}

function staleActiveLeads(leads: LeadRow[], generatedAt: number) {
  const staleAfterMs = 48 * 60 * 60 * 1000;
  return leads.filter(
    (lead) => isActiveLead(lead) && generatedAt - (lead.lastReviewedAt ?? lead.createdAt) > staleAfterMs,
  );
}

function isActiveLead(lead: LeadRow) {
  return !["qualified", "archived"].includes(normalizeAdminLeadStatus(lead.status));
}

function capturedFieldCount(captured: VoiceSessionRow["captured"]) {
  return [captured.name, captured.email, captured.org, captured.phone, captured.website, captured.message].filter(
    (value) => Boolean(value?.trim()),
  ).length;
}

type TranscriptRoleCounts = { user: number; assistant: number; system: number };
type TranscriptRoleEntry = { role: string };

function countTranscriptRoles(transcript: TranscriptRoleEntry[]) {
  return transcript.reduce<TranscriptRoleCounts>(
    (counts, turn) => {
      if (turn.role === "assistant") counts.assistant += 1;
      else if (turn.role === "system") counts.system += 1;
      else counts.user += 1;
      return counts;
    },
    { user: 0, assistant: 0, system: 0 },
  );
}

function summarizeVoiceVariants(sessions: VoiceSessionRow[]) {
  const rows = new Map<
    string,
    {
      variant: string;
      voice: string;
      sessions: number;
      submitted: number;
      errorSessions: number;
      responseTokens: number;
    }
  >();
  for (const session of sessions) {
    const variant = session.variant || "default";
    const voice = session.voice || "unknown";
    const key = `${variant}:${voice}`;
    const row = rows.get(key) ?? { variant, voice, sessions: 0, submitted: 0, errorSessions: 0, responseTokens: 0 };
    row.sessions += 1;
    row.submitted += session.leadId ? 1 : 0;
    row.errorSessions += session.errors.some((error: VoiceRuntimeError) => !isBenignVoiceError(error)) ? 1 : 0;
    row.responseTokens += session.usage?.responseTokens ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, submitRate: Math.round((row.submitted / row.sessions) * 100) }))
    .sort((left, right) => right.sessions - left.sessions || right.errorSessions - left.errorSessions);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
