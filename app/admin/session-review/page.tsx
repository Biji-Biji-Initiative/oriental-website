import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { Badge } from "@/components/admin/Badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminCookieName, verifyAdminSessionCookie } from "@/lib/server/admin-auth";
import { getAdminReviewDashboard } from "@/lib/server/convex";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Session Review | Oriental Admin",
  robots: { index: false, follow: false },
};

type DashboardResult = Awaited<ReturnType<typeof getAdminReviewDashboard>>;
type DashboardData = Extract<DashboardResult, { ok: true }>["data"];
type LeadRow = DashboardData["leads"][number];
type VoiceSessionRow = DashboardData["voiceSessions"][number];

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

  return (
    <AdminShell>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Recent leads" value={dashboard.data.metrics.recentLeads} />
        <MetricCard label="Voice leads" value={dashboard.data.metrics.voiceLeads} />
        <MetricCard label="Notification failures" tone="danger" value={dashboard.data.metrics.notificationFailures} />
        <MetricCard label="Voice sessions" value={dashboard.data.metrics.reviewedSessions} />
        <MetricCard label="Sessions with errors" tone="danger" value={dashboard.data.metrics.sessionsWithErrors} />
        <MetricCard label="Submitted sessions" value={dashboard.data.metrics.submittedSessions} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <LeadsPanel leads={dashboard.data.leads} />
        <VoiceSessionsPanel sessions={dashboard.data.voiceSessions} />
      </section>
    </AdminShell>
  );
}

function AdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-svh bg-mk-paper px-4 py-8 text-mk-off-black sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-6">
        <header className="flex flex-col gap-4 border-b border-mk-ash/20 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mk-blue">Oriental Admin</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Session review</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-mk-ash">
              Review submitted handoffs, voice transcript quality, notification delivery, and Realtime runtime errors.
            </p>
          </div>
          <form action="/api/admin/logout" method="post">
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </header>
        {children}
      </div>
    </main>
  );
}

function MetricCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "danger" }) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm" size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={tone === "danger" && value > 0 ? "text-destructive" : undefined}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function LeadsPanel({ leads }: { leads: LeadRow[] }) {
  return (
    <Card className="border-mk-ash/20 bg-white shadow-sm">
      <CardHeader>
        <CardTitle>Recent handoffs</CardTitle>
        <CardDescription>Latest saved leads with routing and notification status.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {leads.length === 0 ? <EmptyState label="No leads saved yet." /> : null}
        {leads.map((lead) => (
          <article className="rounded-lg border border-mk-ash/15 p-4" key={lead.leadId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{lead.name || "Unnamed"}</div>
                <div className="mt-1 text-xs text-mk-ash">
                  {lead.email} · {lead.org || "No organisation"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={lead.source === "voice" ? "blue" : "neutral"}>{lead.source}</Badge>
                <Badge tone={lead.notificationDelivered ? "green" : "red"}>
                  {lead.notificationDelivered ? "notified" : "notify failed"}
                </Badge>
              </div>
            </div>
            <dl className="mt-4 grid gap-2 text-xs text-mk-ash sm:grid-cols-2">
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Route</dt>
                <dd>{lead.routedTo}</dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-mk-off-black/55">Created</dt>
                <dd>{formatDate(lead.createdAt)}</dd>
              </div>
            </dl>
            <p className="mt-4 whitespace-pre-wrap rounded-lg bg-mk-paper p-3 text-sm leading-6">{lead.message}</p>
            {lead.transcript.length > 0 ? <TranscriptLog transcript={lead.transcript} /> : null}
          </article>
        ))}
      </CardContent>
    </Card>
  );
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
        {sessions.map((session) => (
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
                <Badge tone={session.errors.length > 0 ? "red" : "blue"}>{session.errors.length} errors</Badge>
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
              <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                {session.errors.map((error: { eventId?: string; message: string }) => (
                  <div key={`${error.eventId ?? "error"}:${error.message}`}>{error.message}</div>
                ))}
              </div>
            ) : null}
            {session.transcript.length > 0 ? <TranscriptLog transcript={session.transcript} /> : null}
          </article>
        ))}
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
