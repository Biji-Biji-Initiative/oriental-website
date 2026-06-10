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
import { isBenignVoiceError } from "@/lib/voice/realtime-events";

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
    session.errors.some((error: { eventId?: string; message: string; code?: string }) => !isBenignVoiceError(error)),
  ).length;

  return (
    <AdminShell generatedAt={dashboard.data.generatedAt}>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Recent leads" value={dashboard.data.metrics.recentLeads} />
        <MetricCard label="Active queue" value={dashboard.data.metrics.activeLeads} />
        <MetricCard label="High priority" tone="danger" value={dashboard.data.metrics.urgentLeads} />
        <MetricCard label="Notification health" suffix="%" value={dashboard.data.metrics.notificationDeliveryRate} />
        <MetricCard label="Voice submit rate" suffix="%" value={dashboard.data.metrics.voiceSubmitRate} />
        <MetricCard label="Sessions with errors" tone="danger" value={sessionsWithRealErrors} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <AnalyticsPanel data={dashboard.data} />
        <WorkflowPanel leads={dashboard.data.leads} />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
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
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "default" | "danger";
}) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={tone === "danger" && value > 0 ? "text-destructive" : undefined}>
          {value}
          {suffix}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function WorkflowPanel({ leads }: { leads: LeadRow[] }) {
  const ordered = [...leads].sort(
    (left, right) => priorityRank(right) - priorityRank(left) || right.createdAt - left.createdAt,
  );
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
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
    session.errors.some((error: { eventId?: string; message: string; code?: string }) => !isBenignVoiceError(error)),
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
  return (
    <article className="rounded-lg border border-mk-ash/15 bg-mk-paper/60 p-4">
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
          <Badge tone={lead.notificationDelivered ? "green" : "red"}>
            {lead.notificationDelivered ? "notified" : "notify failed"}
          </Badge>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 text-xs text-mk-ash sm:grid-cols-3">
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Route</dt>
          <dd>{lead.routedTo}</dd>
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

function PriorityPanel({ leads }: { leads: LeadRow[] }) {
  return (
    <QueuePanel
      description="High and urgent handoffs that should get human ownership first."
      emptyLabel="No high-priority handoffs in the recent window."
      leads={leads}
      title="Priority queue"
    />
  );
}

function NotificationPanel({ leads }: { leads: LeadRow[] }) {
  return (
    <QueuePanel
      description="Leads where all configured delivery paths failed or are still unresolved."
      emptyLabel="No notification failures in the recent window."
      leads={leads}
      title="Notification recovery"
    />
  );
}

function QueuePanel({
  description,
  emptyLabel,
  leads,
  title,
}: {
  description: string;
  emptyLabel: string;
  leads: LeadRow[];
  title: string;
}) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {leads.length === 0 ? <EmptyState label={emptyLabel} /> : null}
        {leads.map((lead) => {
          const priority = normalizeAdminLeadPriority(lead.priority);
          const status = normalizeAdminLeadStatus(lead.status);
          return (
            <article className="rounded-lg border border-mk-ash/15 p-3" key={`${title}:${lead.leadId}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{lead.name || "Unnamed"}</div>
                  <div className="mt-1 text-xs text-mk-ash">{lead.email}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
                  <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
                </div>
              </div>
              <div className="mt-3 text-xs text-mk-ash">
                {lead.routedTo} · {lead.owner || "Unassigned"} · {formatDate(lead.createdAt)}
              </div>
              {lead.notificationSummary ? (
                <p className="mt-2 text-xs text-destructive">{lead.notificationSummary}</p>
              ) : null}
            </article>
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

function RecoverableVoicePanel({ sessions }: { sessions: VoiceSessionRow[] }) {
  const unsent = sessions.filter((session) => !session.leadId && session.captured.email.trim().length > 0);
  const recoverable = unsent.filter((session) => !session.followedUpAt);
  const followedUp = unsent.filter((session) => Boolean(session.followedUpAt));
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
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
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>Voice sessions</CardTitle>
        <CardDescription>
          Realtime snapshots for QA, debugging, cost review, and handoff completion checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {sessions.length === 0 ? <EmptyState label="No voice review snapshots yet." /> : null}
        {sessions.map((session) => {
          const realErrorCount = session.errors.filter(
            (error: { eventId?: string; message: string; code?: string }) => !isBenignVoiceError(error),
          ).length;
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
                  <Badge tone={realErrorCount > 0 ? "red" : "blue"}>
                    {realErrorCount > 0
                      ? `${realErrorCount} errors`
                      : benignErrorCount > 0
                        ? `${benignErrorCount} benign`
                        : "0 errors"}
                  </Badge>
                </div>
              </div>
              <dl className="mt-4 grid gap-2 text-xs text-mk-ash sm:grid-cols-2">
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
              </dl>
              <div className="mt-4 grid gap-3 rounded-lg bg-mk-paper p-3 text-sm leading-6">
                <div>
                  <span className="font-semibold">Email:</span> {session.captured.email || "empty"}
                </div>
                <div>
                  <span className="font-semibold">Organisation:</span> {session.captured.org || "empty"}
                </div>
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
                  {session.errors.map((error: { eventId?: string; message: string; code?: string }) => (
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
    <div className="mt-3 grid gap-2 text-xs text-mk-ash sm:grid-cols-3">
      <div>Responses: {session.usage.responseCount}</div>
      <div>Tokens: {session.usage.responseTokens}</div>
      <div>Transcriptions: {session.usage.transcriptionCount}</div>
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

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
