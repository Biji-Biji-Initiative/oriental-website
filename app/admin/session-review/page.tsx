import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AdminAutoRefresh } from "@/components/admin/AdminAutoRefresh";
import { AdminHashOpenDetails } from "@/components/admin/AdminHashOpenDetails";
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
type AdminSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
type AdminFilters = {
  q: string;
  status: string;
  priority: string;
  source: string;
};

export default async function SessionReviewPage({ searchParams }: { searchParams?: AdminSearchParams }) {
  const filters = parseAdminFilters(await searchParams);
  const filterActive = hasActiveFilters(filters);
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
  const filteredLeads = filterLeads(dashboard.data.leads, filters);
  const filteredTriage = filterLeads(dashboard.data.queues.triage, filters);
  const filteredPriority = filterLeads(dashboard.data.queues.highPriority, filters);
  const filteredNotifications = filterLeads(dashboard.data.queues.failedNotifications, filters);
  const filteredVoiceSessions = filterVoiceSessions(dashboard.data.voiceSessions, filters.q);

  return (
    <AdminShell generatedAt={dashboard.data.generatedAt}>
      <AdminNavPills />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.42fr)]" id="command-center">
        <ActionQueuePanel data={dashboard.data} sessionsWithRealErrors={sessionsWithRealErrors} />
        <NextBestActionPanel data={dashboard.data} sessionsWithRealErrors={sessionsWithRealErrors} />
      </section>

      <OperationalHealthStrip data={dashboard.data} sessionsWithRealErrors={sessionsWithRealErrors} />

      <VoiceQualityPanel data={dashboard.data} />

      <OperatorFilters
        filterActive={filterActive}
        filters={filters}
        leadCount={filteredLeads.length}
        totalLeads={dashboard.data.leads.length}
        totalVoiceRecoverable={recoverableVoiceSessions(dashboard.data.voiceSessions).length}
        voiceRecoverableCount={recoverableVoiceSessions(filteredVoiceSessions).length}
      />

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.55fr)]" id="work-queues">
        <WorkflowPanel filterActive={filterActive} leads={filteredLeads} totalLeads={dashboard.data.leads.length} />
        <div className="grid content-start gap-5">
          <RecoverableVoicePanel
            filterActive={filterActive}
            query={filters.q}
            sessions={filteredVoiceSessions}
            totalRecoverable={recoverableVoiceSessions(dashboard.data.voiceSessions).length}
          />
          <TriagePanel
            filterActive={filterActive}
            leads={filteredTriage}
            totalLeads={dashboard.data.queues.triage.length}
          />
          <PriorityPanel
            filterActive={filterActive}
            leads={filteredPriority}
            totalLeads={dashboard.data.queues.highPriority.length}
          />
          <NotificationPanel
            filterActive={filterActive}
            leads={filteredNotifications}
            totalLeads={dashboard.data.queues.failedNotifications.length}
          />
        </div>
      </section>

      <DisclosureSection
        detail="Realtime QA, lifecycle timings, full transcripts, and usage details. Open only when debugging a session."
        id="voice-diagnostics"
        title="Voice diagnostics"
      >
        <VoiceSessionsPanel sessions={dashboard.data.voiceSessions} />
      </DisclosureSection>

      <DisclosureSection
        detail="Acquisition mix, workflow distribution, provider health, and the event audit trail."
        id="insights-audit"
        title="Insights and audit"
      >
        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,0.65fr)]">
          <AnalyticsPanel data={dashboard.data} />
          <EventsPanel events={dashboard.data.leadEvents} />
        </section>
      </DisclosureSection>
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
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Oriental intake cockpit</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-mk-ash">
              Start with the next action, then use the queues below to assign leads, recover unsent voice handoffs, and
              check delivery or Reka quality when something looks off.
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
        <AdminHashOpenDetails />
        {children}
      </div>
    </main>
  );
}

function AdminNavPills() {
  const items = [
    { href: "#command-center", label: "Today" },
    { href: "#reka-quality", label: "Reka quality" },
    { href: "#operator-filters", label: "Find" },
    { href: "#work-queues", label: "Leads" },
    { href: "#voice-recovery", label: "Voice recovery" },
    { href: "#notifications", label: "Notifications" },
    { href: "#voice-diagnostics", label: "Diagnostics" },
    { href: "#insights-audit", label: "Audit" },
  ];
  return (
    <nav
      aria-label="Admin sections"
      className="sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-mk-ash/15 bg-mk-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-full sm:border"
    >
      <div className="flex min-w-max gap-2">
        {items.map((item) => (
          <a
            className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-mk-ash transition hover:bg-white hover:text-mk-blue"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function NextBestActionPanel({
  data,
  sessionsWithRealErrors,
}: {
  data: DashboardData;
  sessionsWithRealErrors: number;
}) {
  const failedNotification = data.queues.failedNotifications[0];
  const recoverable = recoverableVoiceSessions(data.voiceSessions)[0];
  const realtimeError = data.voiceSessions.find(hasNonBenignVoiceErrors);
  const highPriority = data.queues.highPriority.find(isActiveLead);
  const stale = staleActiveLeads(data.leads, data.generatedAt)[0];
  const triage = data.queues.triage[0];

  const action = failedNotification
    ? {
        badge: "Delivery",
        cta: "Open failed handoff",
        detail: `${failedNotification.name || failedNotification.email} may not have reached the owner. Verify Slack/email and manually route it if needed.`,
        href: `#${leadAnchorId(failedNotification)}`,
        title: "Recover the failed notification first",
        tone: "red" as const,
      }
    : recoverable
      ? {
          badge: "Voice",
          cta: "Open recovery queue",
          detail: `${recoverable.captured.name || recoverable.captured.email} shared contact details with Reka but did not submit the handoff.`,
          href: "#voice-recovery",
          title: "Follow up on the unsent voice lead",
          tone: "amber" as const,
        }
      : realtimeError
        ? {
            badge: "QA",
            cta: "Open diagnostics",
            detail: `${realtimeError.captured.name || realtimeError.sessionId} has non-benign Realtime errors worth reviewing before more tests.`,
            href: "#voice-diagnostics",
            title: "Inspect the Realtime session error",
            tone: "red" as const,
          }
        : highPriority
          ? {
              badge: "Priority",
              cta: "Open priority lead",
              detail: `${highPriority.name || highPriority.email} is marked ${normalizeAdminLeadPriority(highPriority.priority)} and still active.`,
              href: `#${leadAnchorId(highPriority)}`,
              title: "Assign the high-priority handoff",
              tone: "amber" as const,
            }
          : stale
            ? {
                badge: "Freshness",
                cta: "Open stale lead",
                detail: `${stale.name || stale.email} has not been reviewed in more than 48 hours.`,
                href: `#${leadAnchorId(stale)}`,
                title: "Refresh a stale active lead",
                tone: "amber" as const,
              }
            : triage
              ? {
                  badge: "Triage",
                  cta: "Open review queue",
                  detail: `${triage.name || triage.email} is waiting for owner, fit, and next-action decisions.`,
                  href: `#${leadAnchorId(triage)}`,
                  title: "Clear the next triage lead",
                  tone: "blue" as const,
                }
              : {
                  badge: "Clear",
                  cta: "Review analytics",
                  detail:
                    "No urgent recovery item is visible in the recent window. Check trends, then keep the queue fresh.",
                  href: "#insights-audit",
                  title: "The critical queue is clear",
                  tone: "green" as const,
                };

  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Next best action</CardTitle>
            <CardDescription>
              The single highest-leverage thing to handle before scanning everything else.
            </CardDescription>
          </div>
          <Badge tone={action.tone}>{action.badge}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border border-mk-ash/15 bg-mk-paper/70 p-4">
          <h2 className="text-xl font-semibold leading-tight">{action.title}</h2>
          <p className="mt-3 text-sm leading-6 text-mk-ash">{action.detail}</p>
          <a
            className="mt-4 inline-flex h-9 items-center rounded-full bg-mk-off-black px-4 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-mk-blue"
            href={action.href}
          >
            {action.cta}
          </a>
        </div>
        <div className="grid gap-2 text-xs leading-5 text-mk-ash">
          <div className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Daily close criteria</div>
          <p>
            Failed notifications at zero, recoverable voice leads followed up, active leads owned, and QA errors
            understood.
          </p>
          {sessionsWithRealErrors > 0 ? (
            <p className="text-destructive">
              Realtime errors are present; do not treat today’s voice tests as clean yet.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function OperationalHealthStrip({
  data,
  sessionsWithRealErrors,
}: {
  data: DashboardData;
  sessionsWithRealErrors: number;
}) {
  const recoverable = recoverableVoiceSessions(data.voiceSessions).length;
  const unassigned = countUnassignedActiveLeads(data.leads);
  const stale = staleActiveLeads(data.leads, data.generatedAt).length;
  const items = [
    { detail: "Recent saved handoffs", label: "Leads", tone: "blue" as const, value: data.metrics.recentLeads },
    {
      detail: `${unassigned} unassigned · ${stale} stale`,
      label: "Active",
      tone: data.metrics.activeLeads > 0 ? ("amber" as const) : ("green" as const),
      value: data.metrics.activeLeads,
    },
    {
      detail: "High or urgent",
      label: "Priority",
      tone: data.metrics.urgentLeads > 0 ? ("amber" as const) : ("green" as const),
      value: data.metrics.urgentLeads,
    },
    {
      detail: `${data.metrics.notificationDeliveryRate}% delivery`,
      label: "Notify failures",
      tone: data.analytics.notification.failed > 0 ? ("red" as const) : ("green" as const),
      value: data.analytics.notification.failed,
    },
    {
      detail: `${data.metrics.voiceSubmitRate}% submit rate`,
      label: "Voice recovery",
      tone: recoverable > 0 ? ("amber" as const) : ("green" as const),
      value: recoverable,
    },
    {
      detail: `${data.metrics.connectedSessions}/${data.metrics.reviewedSessions} connected`,
      label: "QA errors",
      tone: sessionsWithRealErrors > 0 ? ("red" as const) : ("green" as const),
      value: sessionsWithRealErrors,
    },
  ];

  return (
    <section aria-label="Operational health" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {items.map((item) => (
        <div className="rounded-xl border border-mk-ash/15 bg-white p-4 shadow-sm" key={item.label}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">{item.label}</div>
            <Badge tone={item.tone}>{item.value}</Badge>
          </div>
          <p className="mt-3 text-xs leading-5 text-mk-ash">{item.detail}</p>
        </div>
      ))}
    </section>
  );
}

type EvalAnalytics = DashboardData["analytics"]["evals"];
type EvalAttentionEntry = EvalAnalytics["attention"][number];
type RekaFixAction = {
  key: string;
  title: string;
  change: string;
  why: string;
  count: number;
  tone: "neutral" | "blue" | "green" | "red" | "amber";
  entries: EvalAttentionEntry[];
};

function VoiceQualityPanel({ data }: { data: DashboardData }) {
  const evals = data.analytics.evals;
  const averages = evals.averages;
  const dims = [
    { key: "routingCorrect", label: "Routing", value: averages?.routingCorrect ?? null, invert: false },
    { key: "captureCompleteness", label: "Capture", value: averages?.captureCompleteness ?? null, invert: false },
    { key: "conversationQuality", label: "Quality", value: averages?.conversationQuality ?? null, invert: false },
    { key: "frustration", label: "Frustration", value: averages?.frustration ?? null, invert: true },
  ];
  const fixActions = buildRekaFixActions(evals.attention);
  const primaryFix = buildPrimaryRekaFix(fixActions, evals.evaluated);

  return (
    <section aria-label="Reka quality" id="reka-quality">
      <Card className="border-mk-ash/20 bg-white shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Reka fix queue</CardTitle>
              <CardDescription>
                Eval evidence translated into concrete prompt, tool, and recovery changes. Scores are supporting
                evidence, not the work item.
              </CardDescription>
            </div>
            <Badge tone={fixActions.length > 0 ? "amber" : "green"}>
              {fixActions.length > 0 ? `${fixActions.length} fix areas` : "no flagged pattern"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          {evals.evaluated === 0 ? (
            <EmptyState label="No evaluated sessions yet — run the eval to populate quality actions." />
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-amber-700/20 bg-amber-500/10 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={primaryFix.tone}>{primaryFix.badge}</Badge>
                    <span className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-900/70">
                      Fix next
                    </span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold leading-tight text-mk-off-black">{primaryFix.title}</h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-mk-ash">{primaryFix.detail}</p>
                  <a
                    className="mt-4 inline-flex h-9 items-center rounded-full bg-mk-off-black px-4 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-mk-blue"
                    href={primaryFix.href}
                  >
                    {primaryFix.cta}
                  </a>
                  {primaryFix.entries.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {primaryFix.entries.slice(0, 3).map((entry) => (
                        <a
                          className="rounded-full border border-mk-blue/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-mk-blue transition hover:border-mk-blue/45 hover:bg-white"
                          href={`#${voiceSessionAnchorId(entry.reviewId)}`}
                          key={`primary:${entry.reviewId}`}
                        >
                          {getSegment(entry.segment).label} · {entry.reviewId.slice(0, 8)}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="grid content-start gap-2 rounded-xl border border-mk-ash/15 bg-mk-paper/70 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
                    Current eval scores
                  </div>
                  {dims.map((dim) => (
                    <ScoreSummaryRow invert={dim.invert} key={dim.key} label={dim.label} value={dim.value} />
                  ))}
                </div>
              </div>

              {fixActions.length > 1 ? <RekaFixActionList actions={fixActions.slice(1)} /> : null}

              <details className="rounded-lg border border-mk-ash/15 bg-mk-paper/60" suppressHydrationWarning>
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
                  Show score trends and raw flagged sessions
                </summary>
                <div className="grid gap-5 border-t border-mk-ash/15 p-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {dims.map((dim) => (
                      <ScoreTile invert={dim.invert} key={`tile:${dim.key}`} label={dim.label} value={dim.value} />
                    ))}
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <TrendCard buckets={evals.trend.daily} label="Daily quality" />
                    <TrendCard buckets={evals.trend.weekly} label="Weekly quality" />
                  </div>
                  {evals.droppedMidTurn > 0 ? (
                    <HealthBox
                      danger
                      detail="Sessions that dropped while the visitor was speaking. Inspect transport telemetry before changing conversation copy."
                      label="Dropped mid-turn"
                      value={String(evals.droppedMidTurn)}
                    />
                  ) : null}
                  <EvalAttentionList entries={evals.attention} />
                </div>
              </details>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ScoreSummaryRow({ label, value, invert }: { label: string; value: number | null; invert: boolean }) {
  const tone = value === null ? "neutral" : scoreTone(value, invert);
  const verdict = value === null ? "not evaluated" : scoreVerdict(value, invert);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-mk-ash/15 bg-white px-3 py-2 text-sm">
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-xs text-mk-ash">{verdict}</div>
      </div>
      <Badge tone={tone}>{value === null ? "--" : `${value.toFixed(2)}/5`}</Badge>
    </div>
  );
}

function RekaFixActionList({ actions }: { actions: RekaFixAction[] }) {
  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-700/20 bg-emerald-700/5 p-4 text-sm leading-6 text-emerald-800">
        No repeated failure pattern is visible in the current evaluated sessions. Keep watching new evals after the next
        Reka change.
      </div>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {actions.map((action) => (
        <article className="rounded-xl border border-mk-ash/15 bg-white p-4 shadow-sm" key={action.key}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={action.tone}>{action.count} examples</Badge>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Reka change</span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-snug">{action.title}</h3>
          <p className="mt-2 text-sm leading-6 text-mk-ash">
            <span className="font-semibold text-mk-off-black">Change: </span>
            {action.change}
          </p>
          <p className="mt-2 text-xs leading-5 text-mk-ash">
            <span className="font-semibold text-mk-off-black">Evidence: </span>
            {action.why}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {action.entries.slice(0, 3).map((entry) => (
              <a
                className="rounded-full border border-mk-blue/20 bg-mk-blue/5 px-3 py-1.5 text-xs font-semibold text-mk-blue transition hover:border-mk-blue/45 hover:bg-mk-blue/10"
                href={`#${voiceSessionAnchorId(entry.reviewId)}`}
                key={`${action.key}:${entry.reviewId}`}
              >
                {getSegment(entry.segment).label} · {entry.reviewId.slice(0, 8)}
              </a>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function buildPrimaryRekaFix(actions: RekaFixAction[], evaluated: number) {
  const top = actions[0];
  if (!top) {
    return {
      badge: `${evaluated} evaluated`,
      cta: "Open diagnostics",
      detail: "No repeated failure pattern is currently flagged. Use diagnostics only when a new session looks wrong.",
      href: "#voice-diagnostics",
      entries: [] as EvalAttentionEntry[],
      title: "Keep monitoring new sessions",
      tone: "green" as const,
    };
  }
  return {
    badge: `${top.count} examples`,
    cta: "Open first evidence session",
    detail: `${top.change} ${top.why}`,
    href: `#${voiceSessionAnchorId(top.entries[0]?.reviewId ?? "")}`,
    entries: top.entries,
    title: top.title,
    tone: top.tone,
  };
}

function buildRekaFixActions(entries: EvalAttentionEntry[]): RekaFixAction[] {
  const issueActions: RekaFixAction[] = [
    {
      key: "capture",
      title: "Capture useful lead facts before any handoff",
      change:
        "Require name, valid email, organisation, and intended contribution before route_to_team; if email is malformed, stop and ask for a correction.",
      why: "The evaluator says Reka is losing essential lead details, which makes follow-up weak even when the visitor is interested.",
      count: 0,
      tone: "red",
      entries: entries.filter(isCaptureIssue),
    },
    {
      key: "routing",
      title: "Confirm the partner segment before routing",
      change:
        "Have Reka summarise the inferred segment and ask one confirmation question before selecting the owner route.",
      why: "Routing failures mean the team receives the wrong context or wrong owner for otherwise recoverable conversations.",
      count: 0,
      tone: "amber",
      entries: entries.filter(isRoutingIssue),
    },
    {
      key: "engagement",
      title: "Shorten the conversation and ask one concrete next question",
      change:
        "Replace vague recovery turns with one specific question about what the visitor wants to bring to Oriental, then capture the answer.",
      why: "Frustration and low-quality sessions point to unclear direction, low engagement, and conversations ending without useful data.",
      count: 0,
      tone: "amber",
      entries: entries.filter(isEngagementIssue),
    },
    {
      key: "transport",
      title: "Inspect transport before changing the prompt",
      change:
        "For dropped-mid-turn sessions, review WebRTC telemetry first; prompt changes will not fix network or session-transport failures.",
      why: "A spoken lead can be lost if the session drops while the visitor is talking.",
      count: 0,
      tone: "red",
      entries: entries.filter((entry) => entry.droppedMidTurn),
    },
  ];
  return issueActions
    .map((action) => ({ ...action, count: action.entries.length }))
    .filter((action) => action.count > 0)
    .sort((left, right) => right.count - left.count || issuePriority(left.key) - issuePriority(right.key));
}

function isCaptureIssue(entry: EvalAttentionEntry) {
  const summary = entry.summary.toLowerCase();
  return entry.captureCompleteness <= 2 || /capture|lead detail|contact detail|useful lead/.test(summary);
}

function isRoutingIssue(entry: EvalAttentionEntry) {
  const summary = entry.summary.toLowerCase();
  return entry.routingCorrect <= 2 || /route|routing|segment|correct owner/.test(summary);
}

function isEngagementIssue(entry: EvalAttentionEntry) {
  const summary = entry.summary.toLowerCase();
  return (
    entry.frustration >= 4 || entry.conversationQuality <= 2 || /frustrat|engagement|clarity|direction/.test(summary)
  );
}

function issuePriority(key: string) {
  return (
    { capture: 0, routing: 1, engagement: 2, transport: 3 }[
      key as "capture" | "routing" | "engagement" | "transport"
    ] ?? 9
  );
}

function scoreVerdict(value: number, invert: boolean) {
  const normalized = invert ? 5 - value : value;
  if (normalized >= 3.75) return "healthy enough";
  if (normalized >= 2.5) return "watch";
  return "needs prompt/tool work";
}

function OperatorFilters({
  filters,
  filterActive,
  leadCount,
  totalLeads,
  voiceRecoverableCount,
  totalVoiceRecoverable,
}: {
  filters: AdminFilters;
  filterActive: boolean;
  leadCount: number;
  totalLeads: number;
  voiceRecoverableCount: number;
  totalVoiceRecoverable: number;
}) {
  return (
    <section aria-label="Operator filters" id="operator-filters">
      <Card className="border-mk-ash/20 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Find a handoff</CardTitle>
              <CardDescription>
                Filter the visible queues by contact, organisation, source, status, or priority. Metrics above stay
                unfiltered.
              </CardDescription>
            </div>
            <Badge tone={filterActive ? "blue" : "neutral"}>
              {filterActive ? `${leadCount}/${totalLeads} shown` : `${totalLeads} recent leads`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/session-review#work-queues"
            className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(3,160px)_auto_auto]"
          >
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
              Search
              <input
                className="h-10 rounded-lg border border-mk-ash/25 bg-white px-3 text-sm font-normal normal-case tracking-normal text-mk-off-black outline-none transition placeholder:text-mk-ash/70 focus:border-mk-blue focus:ring-2 focus:ring-mk-blue/10"
                defaultValue={filters.q}
                name="q"
                placeholder="name, email, org, note"
                type="search"
              />
            </label>
            <FilterSelect label="Status" name="status" options={adminLeadStatusLabels} value={filters.status} />
            <FilterSelect label="Priority" name="priority" options={adminLeadPriorityLabels} value={filters.priority} />
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
              Source
              <select
                className="h-10 rounded-lg border border-mk-ash/25 bg-white px-3 text-sm font-normal normal-case tracking-normal text-mk-off-black outline-none transition focus:border-mk-blue focus:ring-2 focus:ring-mk-blue/10"
                defaultValue={filters.source}
                name="source"
              >
                <option value="">All</option>
                <option value="form">Form</option>
                <option value="voice">Voice</option>
                <option value="newsletter">Newsletter</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button className="h-10 w-full" type="submit">
                Apply
              </Button>
            </div>
            <div className="flex items-end">
              <a
                className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-mk-ash/25 bg-white px-3 text-sm font-medium transition hover:bg-mk-paper"
                href="/admin/session-review#work-queues"
              >
                Reset
              </a>
            </div>
          </form>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-mk-ash">
            <span className="rounded-full bg-mk-paper px-3 py-1">
              Leads: {leadCount}/{totalLeads}
            </span>
            <span className="rounded-full bg-mk-paper px-3 py-1">
              Voice recovery: {voiceRecoverableCount}/{totalVoiceRecoverable}
            </span>
            {filterActive ? (
              <span className="rounded-full bg-mk-blue/10 px-3 py-1 text-mk-blue">Filtered queue view</span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function FilterSelect({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: Record<string, string>;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
      {label}
      <select
        className="h-10 rounded-lg border border-mk-ash/25 bg-white px-3 text-sm font-normal normal-case tracking-normal text-mk-off-black outline-none transition focus:border-mk-blue focus:ring-2 focus:ring-mk-blue/10"
        defaultValue={value}
        name={name}
      >
        <option value="">All</option>
        {Object.entries(options).map(([key, labelText]) => (
          <option key={`${name}:${key}`} value={key}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function scoreTone(value: number, invert: boolean): "green" | "amber" | "red" {
  const normalized = invert ? 5 - value : value;
  if (normalized >= 3.75) return "green";
  if (normalized >= 2.5) return "amber";
  return "red";
}

const scoreBarClass: Record<"green" | "amber" | "red", string> = {
  green: "bg-emerald-600",
  amber: "bg-amber-500",
  red: "bg-destructive",
};

function ScoreTile({ label, value, invert }: { label: string; value: number | null; invert: boolean }) {
  const tone = value === null ? null : scoreTone(value, invert);
  const pct = value === null ? 0 : (value / 5) * 100;
  return (
    <div className="rounded-xl border border-mk-ash/15 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">{label}</span>
        <span className="text-lg font-semibold text-mk-off-black">
          {value === null ? "—" : value.toFixed(2)}
          <span className="ml-0.5 text-xs font-normal text-mk-ash">/5</span>
        </span>
      </div>
      <div className="mt-3 h-2 rounded-full bg-mk-paper">
        <div
          className={`h-2 rounded-full ${tone ? scoreBarClass[tone] : "bg-mk-ash/30"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-mk-ash">{invert ? "lower is better" : "higher is better"}</p>
    </div>
  );
}

function TrendCard({ buckets, label }: { buckets: EvalAnalytics["trend"]["daily"]; label: string }) {
  const points = buckets
    .filter((bucket) => bucket.averages)
    .map((bucket) => ({
      label: bucket.key.includes("W") ? bucket.key.split("-").slice(1).join("-") : bucket.key.slice(5),
      value: bucket.averages?.conversationQuality ?? 0,
      count: bucket.count,
    }));
  return (
    <div className="rounded-lg border border-mk-ash/15 bg-mk-paper p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">{label}</span>
        <span className="text-[11px] text-mk-ash">conversation quality · 0–5</span>
      </div>
      {points.length === 0 ? (
        <div className="py-6 text-center text-xs text-mk-ash">Not enough evaluated sessions yet.</div>
      ) : (
        <TrendChart points={points} />
      )}
    </div>
  );
}

// Static inline SVG line chart (RSC-safe, no client JS). Scale fixed 0–5.
function TrendChart({ points }: { points: Array<{ label: string; value: number; count: number }> }) {
  const width = 100;
  const height = 42;
  const max = 5;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((point, index) => ({
    x: points.length === 1 ? width / 2 : index * step,
    y: height - (point.value / max) * height,
    ...point,
  }));
  const line = coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
  return (
    <div className="grid gap-2">
      <svg
        className="h-16 w-full text-mk-blue"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>Conversation quality over time (0–5)</title>
        <line
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={0.5}
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
        />
        {points.length > 1 ? (
          <polyline
            fill="none"
            points={line}
            stroke="currentColor"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {coords.map((coord) => (
          <circle
            cx={coord.x}
            cy={coord.y}
            fill="currentColor"
            key={coord.label}
            r={1.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-mk-ash">
        {coords.map((coord) => (
          <span
            className="flex-1 text-center"
            key={coord.label}
            title={`${coord.label}: ${coord.value.toFixed(2)} (${coord.count} sessions)`}
          >
            {coord.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function EvalAttentionList({ entries }: { entries: EvalAnalytics["attention"] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-700/20 bg-emerald-700/5 p-3 text-xs text-emerald-800">
        No sessions flagged for attention in this window.
      </div>
    );
  }
  const visible = entries.slice(0, 5);
  const hidden = entries.slice(5);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
          Needs attention ({entries.length})
        </div>
        {hidden.length > 0 ? <Badge tone="amber">Top 5 shown</Badge> : null}
      </div>
      {visible.map((entry) => (
        <EvalAttentionRow entry={entry} key={entry.reviewId} />
      ))}
      {hidden.length > 0 ? (
        <details className="rounded-lg border border-mk-ash/15 bg-mk-paper/60" suppressHydrationWarning>
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold marker:hidden">
            Show {hidden.length} additional flagged {hidden.length === 1 ? "session" : "sessions"}
          </summary>
          <div className="grid gap-2 border-t border-mk-ash/15 p-3">
            {hidden.map((entry) => (
              <EvalAttentionRow entry={entry} key={`hidden:${entry.reviewId}`} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function EvalAttentionRow({ entry }: { entry: EvalAnalytics["attention"][number] }) {
  return (
    <div className="grid gap-1 rounded-lg border border-mk-ash/15 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{getSegment(entry.segment).label}</Badge>
        {entry.droppedMidTurn ? <Badge tone="red">dropped mid-turn</Badge> : null}
        {typeof entry.frustration === "number" && entry.frustration >= 4 ? (
          <Badge tone="amber">frustrated</Badge>
        ) : null}
        {typeof entry.conversationQuality === "number" ? (
          <Badge tone={scoreTone(entry.conversationQuality, false)}>quality {entry.conversationQuality}</Badge>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-mk-ash">{entry.reviewId.slice(0, 8)}</span>
      </div>
      {entry.summary ? <p className="text-xs leading-5 text-mk-ash">{entry.summary}</p> : null}
    </div>
  );
}

function DisclosureSection({
  children,
  detail,
  id,
  title,
}: {
  children: ReactNode;
  detail: string;
  id: string;
  title: string;
}) {
  return (
    <details className="group rounded-xl border border-mk-ash/20 bg-white shadow-sm" id={id} suppressHydrationWarning>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-4 py-4 marker:hidden">
        <span>
          <span className="block text-base font-semibold leading-snug">{title}</span>
          <span className="mt-1 block text-sm leading-6 text-mk-ash">{detail}</span>
        </span>
        <span className="rounded-full border border-mk-ash/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-mk-ash group-open:hidden">
          Open
        </span>
        <span className="hidden rounded-full border border-mk-blue/20 bg-mk-blue/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-mk-blue group-open:inline-flex">
          Close
        </span>
      </summary>
      <div className="border-t border-mk-ash/15 py-4">{children}</div>
    </details>
  );
}

function WorkflowPanel({
  leads,
  filterActive,
  totalLeads,
}: {
  leads: LeadRow[];
  filterActive: boolean;
  totalLeads: number;
}) {
  const ordered = [...leads].sort(
    (left, right) => priorityRank(right) - priorityRank(left) || right.createdAt - left.createdAt,
  );
  const active = ordered.filter((lead) => isActiveLead(lead) || lead.notificationDelivered === false);
  const visible = (active.length > 0 ? active : ordered).slice(0, active.length > 0 ? 5 : 4);
  const visibleIds = new Set(visible.map((lead) => lead.leadId));
  const hidden = ordered.filter((lead) => !visibleIds.has(lead.leadId));
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id="workflow">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Lead action queue</CardTitle>
            <CardDescription>
              {filterActive
                ? `Showing ${ordered.length} of ${totalLeads} recent handoffs that match the current filters.`
                : "The first few active or risky handoffs are expanded here. Everything else stays one click away below."}
            </CardDescription>
          </div>
          <Badge tone={active.length > 0 ? "amber" : "green"}>
            {filterActive ? `${ordered.length} shown` : `${active.length} active`}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {ordered.length === 0 ? (
          <EmptyState label={filterActive ? "No recent leads match these filters." : "No leads saved yet."} />
        ) : null}
        {visible.map((lead) => (
          <WorkflowLeadCard key={lead.leadId} lead={lead} />
        ))}
        {hidden.length > 0 ? (
          <details className="rounded-lg border border-mk-ash/15 bg-mk-paper/60" suppressHydrationWarning>
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
              Show {hidden.length} additional recent {hidden.length === 1 ? "lead" : "leads"}
            </summary>
            <div className="grid gap-2 border-t border-mk-ash/15 p-3">
              {hidden.map((lead) => (
                <CompactLeadRow key={`compact:${lead.leadId}`} lead={lead} />
              ))}
            </div>
          </details>
        ) : null}
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
            detail={`${data.analytics.voice.submitted}/${data.analytics.voice.engaged || data.analytics.voice.sessions} engaged submitted · ${data.analytics.voice.connected} connected · ${data.analytics.voice.prewarmed} prewarmed · ${recoverableCount} recoverable · ${voiceRealErrors} with errors · ${data.analytics.voice.totalResponseTokens} response tokens`}
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
    <article className="scroll-mt-24 rounded-lg border border-mk-ash/15 bg-mk-paper/60 p-4" id={leadAnchorId(lead)}>
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
      <div className="mt-4 rounded-lg border border-mk-ash/15 bg-white p-3 text-sm leading-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">
          Recommended next step
        </div>
        <p className="mt-1 text-mk-ash">{leadActionHint(lead)}</p>
      </div>
      {lead.message ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-mk-ash">{lead.message}</p> : null}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mk-ash">
        <span>{lead.routedTo}</span>
        <span>{lead.owner?.trim() || "Unassigned"}</span>
        <span>{formatDate(lead.createdAt)}</span>
      </div>
      {lead.workflowNote ? (
        <p className="mt-3 rounded-lg bg-mk-horizon/15 p-3 text-xs leading-5 text-mk-ash">{lead.workflowNote}</p>
      ) : null}
      <details className="mt-3 rounded-lg border border-mk-ash/15 bg-white" suppressHydrationWarning>
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-mk-blue marker:hidden">
          Update workflow
        </summary>
        <div className="border-t border-mk-ash/15 px-3 pb-3">
          <AdminLeadWorkflowForm
            leadId={lead.leadId}
            initialOwner={lead.owner}
            initialPriority={priority}
            initialStatus={status}
          />
        </div>
      </details>
      <details className="mt-3 rounded-lg border border-mk-ash/15 bg-white" suppressHydrationWarning>
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-mk-ash marker:hidden">
          Route, metadata, and transcript
        </summary>
        <div className="border-t border-mk-ash/15 p-3">
          <dl className="grid gap-2 text-xs text-mk-ash sm:grid-cols-4">
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
          {lead.voiceReviewId ? (
            <a
              className="mt-3 inline-flex rounded-full border border-mk-blue/20 bg-mk-blue/5 px-3 py-1.5 text-xs font-semibold text-mk-blue transition hover:border-mk-blue/45 hover:bg-mk-blue/10"
              href={`#${voiceSessionAnchorId(lead.voiceReviewId)}`}
            >
              Open source voice session · {lead.voiceVariant || "default"}
            </a>
          ) : null}
          {lead.transcript.length > 0 ? <TranscriptLog transcript={lead.transcript} /> : null}
        </div>
      </details>
    </article>
  );
}

function CompactLeadRow({ lead }: { lead: LeadRow }) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  return (
    <a
      className="grid gap-2 rounded-lg border border-mk-ash/15 bg-white p-3 text-sm transition hover:border-mk-blue/40 hover:bg-mk-paper/70 sm:grid-cols-[minmax(0,1fr)_auto]"
      href={`#${leadAnchorId(lead)}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{lead.name || lead.email}</span>
        <span className="mt-1 block truncate text-xs text-mk-ash">
          {lead.email} · {lead.org || "No organisation"} · {formatDate(lead.createdAt)}
        </span>
      </span>
      <span className="flex flex-wrap gap-2 sm:justify-end">
        <Badge tone={priorityTone(priority)}>{adminLeadPriorityLabels[priority]}</Badge>
        <Badge tone={statusTone(status)}>{adminLeadStatusLabels[status]}</Badge>
      </span>
    </a>
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

function TriagePanel({
  leads,
  filterActive,
  totalLeads,
}: {
  leads: LeadRow[];
  filterActive: boolean;
  totalLeads: number;
}) {
  return (
    <QueuePanel
      description={
        filterActive
          ? `${leads.length}/${totalLeads} review handoffs match the filters.`
          : "New and reviewing handoffs that need owner, priority, or next-action decisions."
      }
      emptyLabel="No triage leads in the recent window."
      filterActive={filterActive}
      id="triage"
      leads={leads}
      title="Needs review"
    />
  );
}

function PriorityPanel({
  leads,
  filterActive,
  totalLeads,
}: {
  leads: LeadRow[];
  filterActive: boolean;
  totalLeads: number;
}) {
  return (
    <QueuePanel
      description={
        filterActive
          ? `${leads.length}/${totalLeads} priority handoffs match the filters.`
          : "High and urgent handoffs that should get human ownership first."
      }
      emptyLabel="No high-priority handoffs in the recent window."
      filterActive={filterActive}
      id="priority"
      leads={leads}
      title="Priority queue"
    />
  );
}

function NotificationPanel({
  leads,
  filterActive,
  totalLeads,
}: {
  leads: LeadRow[];
  filterActive: boolean;
  totalLeads: number;
}) {
  return (
    <QueuePanel
      description={
        filterActive
          ? `${leads.length}/${totalLeads} failed-notification handoffs match the filters.`
          : "Leads where configured delivery paths definitely failed after a send attempt."
      }
      emptyLabel="No confirmed notification failures in the recent window."
      filterActive={filterActive}
      id="notifications"
      leads={leads}
      title="Notification recovery"
    />
  );
}

function QueuePanel({
  description,
  emptyLabel,
  filterActive,
  id,
  leads,
  title,
}: {
  description: string;
  emptyLabel: string;
  filterActive: boolean;
  id: string;
  leads: LeadRow[];
  title: string;
}) {
  const visible = leads.slice(0, 5);
  const hiddenCount = Math.max(leads.length - visible.length, 0);
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id={id}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {leads.length === 0 ? (
          <EmptyState label={filterActive ? "No leads in this queue match the filters." : emptyLabel} />
        ) : null}
        {visible.map((lead) => {
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
        {hiddenCount > 0 ? (
          <a
            className="rounded-lg border border-dashed border-mk-ash/25 p-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-mk-blue transition hover:border-mk-blue/40 hover:bg-mk-blue/5"
            href="#workflow"
          >
            {hiddenCount} more in lead workflow
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventsPanel({ events }: { events: LeadEventRow[] }) {
  const visible = events.slice(0, 12);
  const hidden = events.slice(12);
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
        <CardDescription>Recent system and admin events written beside lead records.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {events.length === 0 ? <EmptyState label="No lead events yet." /> : null}
        {visible.map((event) => (
          <EventRow event={event} key={`${event.leadId}:${event.createdAt}:${event.kind}`} />
        ))}
        {hidden.length > 0 ? (
          <details className="rounded-lg border border-mk-ash/15 bg-mk-paper/60" suppressHydrationWarning>
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold marker:hidden">
              Show {hidden.length} older audit events
            </summary>
            <div className="grid gap-3 border-t border-mk-ash/15 p-3">
              {hidden.map((event) => (
                <EventRow event={event} key={`hidden:${event.leadId}:${event.createdAt}:${event.kind}`} />
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventRow({ event }: { event: LeadEventRow }) {
  return (
    <article className="rounded-lg border border-mk-ash/15 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold capitalize">{event.kind.replaceAll("_", " ")}</div>
        <Badge tone={event.actor === "admin" ? "blue" : "neutral"}>{event.actor ?? "system"}</Badge>
      </div>
      <div className="mt-1 break-all text-xs text-mk-ash">{event.leadId}</div>
      {event.fromStatus || event.toStatus ? (
        <div className="mt-2 text-xs text-mk-ash">
          {event.fromStatus ?? "n/a"} {"->"} {event.toStatus ?? "n/a"}
        </div>
      ) : null}
      {event.note ? <p className="mt-2 line-clamp-3 text-sm leading-6">{event.note}</p> : null}
      <div className="mt-2 text-xs text-mk-ash">{formatDate(event.createdAt)}</div>
    </article>
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
      href: "#voice-diagnostics",
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

function RecoverableVoicePanel({
  sessions,
  filterActive,
  query,
  totalRecoverable,
}: {
  sessions: VoiceSessionRow[];
  filterActive: boolean;
  query: string;
  totalRecoverable: number;
}) {
  const unsent = sessions.filter((session) => !session.leadId && session.captured.email.trim().length > 0);
  const recoverable = unsent.filter((session) => !session.followedUpAt);
  const followedUp = unsent.filter((session) => Boolean(session.followedUpAt));
  const visibleRecoverable = recoverable.slice(0, 4);
  const hiddenRecoverable = recoverable.slice(4);
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" id="voice-recovery">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Recoverable voice leads</CardTitle>
            <CardDescription>
              {filterActive
                ? `${recoverable.length}/${totalRecoverable} unsent voice leads match${query ? ` "${query}"` : " the current filters"}.`
                : "Visitors who shared contact details with Reka but never sent the handoff. Follow up before they go cold."}
            </CardDescription>
          </div>
          <Badge tone={recoverable.length > 0 ? "amber" : "green"}>{recoverable.length} unsent</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {recoverable.length === 0 ? (
          <EmptyState
            label={
              filterActive
                ? "No unsent voice sessions match the current search."
                : "No unsent voice sessions waiting for follow-up."
            }
          />
        ) : null}
        {visibleRecoverable.map((session) => {
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
        {hiddenRecoverable.length > 0 ? (
          <details className="rounded-lg border border-mk-ash/15 bg-mk-paper/60" suppressHydrationWarning>
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold marker:hidden">
              Show {hiddenRecoverable.length} more recoverable {hiddenRecoverable.length === 1 ? "session" : "sessions"}
            </summary>
            <div className="grid gap-2 border-t border-mk-ash/15 p-3">
              {hiddenRecoverable.map((session) => (
                <div
                  className="grid gap-2 rounded-lg border border-mk-ash/15 bg-white p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={`hidden:${session.reviewId}`}
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-sm">{session.captured.name || "Unnamed visitor"}</div>
                    <div className="mt-1 truncate text-mk-ash">
                      {session.captured.email}
                      {session.captured.org ? ` · ${session.captured.org}` : ""}
                    </div>
                    <div className="mt-1 text-mk-ash">
                      {getSegment(session.segment).routedTo.name} · {formatDate(session.updatedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <a
                      className="inline-flex h-8 items-center rounded-full bg-mk-off-black px-3 text-xs font-semibold text-white transition hover:bg-mk-blue"
                      href={followUpMailto(session)}
                    >
                      Email
                    </a>
                    <AdminVoiceFollowUpButton markAs={true} reviewId={session.reviewId}>
                      Done
                    </AdminVoiceFollowUpButton>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
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
  const reviewNeeded = sessions.filter(sessionNeedsVoiceReview);
  const reviewIds = new Set(reviewNeeded.map((session) => session.reviewId));
  const routine = sessions.filter((session) => !reviewIds.has(session.reviewId));
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
        {reviewNeeded.length > 0 ? (
          <div className="grid gap-3 rounded-lg border border-amber-700/20 bg-amber-500/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">Review first</div>
            {reviewNeeded.map((session) => (
              <VoiceSessionDetails key={session.reviewId} session={session} />
            ))}
          </div>
        ) : null}
        {routine.length > 0 ? (
          <details className="rounded-lg border border-mk-ash/15 bg-mk-paper/60" suppressHydrationWarning>
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold marker:hidden">
              Show {routine.length} routine voice {routine.length === 1 ? "session" : "sessions"}
            </summary>
            <div className="grid gap-3 border-t border-mk-ash/15 p-3">
              {routine.map((session) => (
                <VoiceSessionDetails key={session.reviewId} session={session} />
              ))}
            </div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function VoiceSessionDetails({ session }: { session: VoiceSessionRow }) {
  const realErrorCount = realVoiceErrorCount(session);
  const benignErrorCount = session.errors.length - realErrorCount;
  return (
    <details
      className="rounded-lg border border-mk-ash/15 bg-white"
      id={voiceSessionAnchorId(session.reviewId)}
      suppressHydrationWarning
    >
      <summary className="cursor-pointer list-none p-4 marker:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{session.captured.name || "Uncaptured visitor"}</div>
            <div className="mt-1 text-xs text-mk-ash">
              {session.segment} · updated {formatDate(session.updatedAt)}
            </div>
            {session.captured.email ? (
              <div className="mt-1 break-all text-xs text-mk-ash">{session.captured.email}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={session.leadId ? "green" : "neutral"}>{session.leadId ? "submitted" : session.status}</Badge>
            {session.variant ? <Badge tone="blue">{session.variant}</Badge> : null}
            {session.prewarmedAt ? <Badge tone="neutral">prewarmed</Badge> : null}
            {session.connectedAt ? <Badge tone="green">connected</Badge> : null}
            {session.closeReason ? (
              <Badge tone={closeReasonTone(session.closeReason)}>{session.closeReason}</Badge>
            ) : null}
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
      </summary>
      <div className="border-t border-mk-ash/15 p-4">
        <dl className="grid gap-2 text-xs text-mk-ash sm:grid-cols-4">
          <div>
            <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Session</dt>
            <dd className="break-all">{session.sessionId}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Model</dt>
            <dd>
              {[session.model, session.voice, session.speed ? `${session.speed}x` : null].filter(Boolean).join(" · ") ||
                "n/a"}
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
        <SessionLifecycle session={session} />
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
      </div>
    </details>
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
  const prewarmed = sessions.filter((session) => session.prewarmedAt).length;
  const connected = sessions.filter((session) => session.connectedAt).length;
  return (
    <div className="grid gap-3 rounded-lg border border-mk-ash/15 bg-mk-paper/70 p-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">QA summary</div>
        <div className="mt-3 grid gap-2 text-xs text-mk-ash sm:grid-cols-2 lg:grid-cols-1">
          <div>{sessions.length} snapshots reviewed</div>
          <div>{prewarmed} page-load prewarms</div>
          <div>{connected} sessions reached live audio</div>
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
              <th className="py-2 pr-3 font-semibold uppercase tracking-[0.12em]">Connect</th>
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
                <td className="py-2 pr-3">{row.connectRate}%</td>
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

function SessionLifecycle({ session }: { session: VoiceSessionRow }) {
  const rows = [
    { label: "Prewarm", value: session.prewarmedAt ? formatDate(session.prewarmedAt) : "--" },
    { label: "Connect start", value: session.connectStartedAt ? formatDate(session.connectStartedAt) : "--" },
    {
      label: "Prewarm head start",
      value:
        session.prewarmedAt && session.connectStartedAt
          ? formatDuration(session.connectStartedAt - session.prewarmedAt)
          : "--",
    },
    {
      label: "Time to live",
      value:
        session.connectStartedAt && session.connectedAt
          ? formatDuration(session.connectedAt - session.connectStartedAt)
          : "--",
    },
    {
      label: "First event",
      value:
        session.connectedAt && session.firstEventAt
          ? formatDuration(session.firstEventAt - session.connectedAt)
          : session.firstEventAt
            ? formatDate(session.firstEventAt)
            : "--",
    },
    { label: "Closed", value: session.closedAt ? formatDate(session.closedAt) : "--" },
  ];

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-mk-ash/15 bg-white p-3 text-xs text-mk-ash sm:grid-cols-3 xl:grid-cols-6">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">{row.label}</div>
          <div className="mt-1">{row.value}</div>
        </div>
      ))}
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
      {session.prewarmedAt && !session.connectStartedAt ? <Badge tone="neutral">prewarm only</Badge> : null}
      {session.connectStartedAt && !session.connectedAt ? <Badge tone="amber">did not connect</Badge> : null}
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

function realVoiceErrorCount(session: VoiceSessionRow) {
  return session.errors.filter((error: VoiceRuntimeError) => !isBenignVoiceError(error)).length;
}

function hasNonBenignVoiceErrors(session: VoiceSessionRow) {
  return realVoiceErrorCount(session) > 0;
}

function sessionNeedsVoiceReview(session: VoiceSessionRow) {
  return (
    hasNonBenignVoiceErrors(session) ||
    Boolean(session.connectStartedAt && !session.connectedAt) ||
    (!session.leadId && session.captured.email.trim().length > 0 && !session.followedUpAt)
  );
}

function leadActionHint(lead: LeadRow) {
  const status = normalizeAdminLeadStatus(lead.status);
  const priority = normalizeAdminLeadPriority(lead.priority);
  if (lead.notificationDelivered === false)
    return "Confirm whether email or Slack failed, then manually notify the routed owner.";
  if (!lead.owner?.trim()) return "Assign an owner so the handoff has a visible human accountable for follow-up.";
  if (priority === "urgent" || priority === "high")
    return "Contact this partner quickly and record the next agreed step.";
  if (status === "new") return "Review fit, set priority, and move it to reviewing or contacted.";
  if (status === "reviewing") return "Decide the next outbound step and update the workflow note.";
  return "Keep the record current if anything changed since the last review.";
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
      connected: number;
      errorSessions: number;
      responseTokens: number;
    }
  >();
  for (const session of sessions) {
    const variant = session.variant || "default";
    const voice = session.voice || "unknown";
    const key = `${variant}:${voice}`;
    const row = rows.get(key) ?? {
      variant,
      voice,
      sessions: 0,
      submitted: 0,
      connected: 0,
      errorSessions: 0,
      responseTokens: 0,
    };
    row.sessions += 1;
    row.submitted += session.leadId ? 1 : 0;
    row.connected += session.connectedAt ? 1 : 0;
    row.errorSessions += session.errors.some((error: VoiceRuntimeError) => !isBenignVoiceError(error)) ? 1 : 0;
    row.responseTokens += session.usage?.responseTokens ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      submitRate: Math.round((row.submitted / row.sessions) * 100),
      connectRate: Math.round((row.connected / row.sessions) * 100),
    }))
    .sort((left, right) => right.sessions - left.sessions || right.errorSessions - left.errorSessions);
}

function voiceSessionAnchorId(reviewId: string) {
  return `voice-${reviewId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function closeReasonTone(reason: string): "neutral" | "blue" | "green" | "red" | "amber" {
  if (reason === "manual" || reason === "idle_timeout" || reason === "max_duration") return "neutral";
  if (reason === "voice_limit_reached" || reason === "mic_denied") return "amber";
  return "red";
}

function formatDuration(ms: number | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

function parseAdminFilters(searchParams: Awaited<AdminSearchParams> | undefined): AdminFilters {
  const readParam = (key: string) => {
    const value = searchParams?.[key];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  };
  return {
    q: readParam("q").trim(),
    status: normalizeFilterValue(readParam("status"), Object.keys(adminLeadStatusLabels)),
    priority: normalizeFilterValue(readParam("priority"), Object.keys(adminLeadPriorityLabels)),
    source: normalizeFilterValue(readParam("source"), ["form", "voice", "newsletter"]),
  };
}

function hasActiveFilters(filters: AdminFilters) {
  return Boolean(filters.q || filters.status || filters.priority || filters.source);
}

function filterLeads(leads: LeadRow[], filters: AdminFilters) {
  return leads.filter((lead) => {
    if (filters.status && normalizeAdminLeadStatus(lead.status) !== filters.status) return false;
    if (filters.priority && normalizeAdminLeadPriority(lead.priority) !== filters.priority) return false;
    if (filters.source && lead.source !== filters.source) return false;
    return matchesLeadQuery(lead, filters.q);
  });
}

function filterVoiceSessions(sessions: VoiceSessionRow[], query: string) {
  if (!query.trim()) return sessions;
  const normalized = normalizeSearchText(query);
  return sessions.filter((session) =>
    normalizeSearchText(
      [
        session.captured.name,
        session.captured.email,
        session.captured.org,
        session.captured.phone,
        session.captured.website,
        session.captured.message,
        session.segment,
        session.reviewId,
      ].join(" "),
    ).includes(normalized),
  );
}

function matchesLeadQuery(lead: LeadRow, query: string) {
  if (!query.trim()) return true;
  const normalized = normalizeSearchText(query);
  return normalizeSearchText(
    [
      lead.name,
      lead.email,
      lead.org,
      lead.phone,
      lead.website,
      lead.message,
      lead.workflowNote,
      lead.owner,
      lead.routedTo,
      lead.routedToEmail,
      lead.segment,
      lead.source,
      lead.leadId,
    ].join(" "),
  ).includes(normalized);
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .trim();
}

function normalizeFilterValue(value: string, allowed: string[]) {
  return allowed.includes(value) ? value : "";
}
