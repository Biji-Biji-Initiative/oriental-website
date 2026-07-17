import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  MailCheckIcon,
  SparklesIcon,
  UserRoundCheckIcon,
  UsersRoundIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/admin/Badge";
import { buildAdminCommandCenter } from "@/lib/admin-command-center";
import { adminLeadPriorityLabels, adminLeadStatusLabels, normalizeAdminLeadPriority } from "@/lib/admin-workflow";
import { getSegment } from "@/lib/segments";
import type { getAdminReviewDashboard } from "@/lib/server/convex";

type DashboardResult = Awaited<ReturnType<typeof getAdminReviewDashboard>>;
type DashboardData = Extract<DashboardResult, { ok: true }>["data"];
type LeadRow = DashboardData["leads"][number];
type AdminTone = "neutral" | "blue" | "green" | "red" | "amber";

export function AdminCommandCenter({
  data,
  sessionsWithRealErrors,
}: {
  data: DashboardData;
  sessionsWithRealErrors: number;
}) {
  const command = buildAdminCommandCenter(data.leads, data.generatedAt);
  const highest = command.attention[0];
  const recoverableVoice = data.voiceSessions.filter(
    (session) => !session.leadId && session.captured.email.trim().length > 0 && !session.followedUpAt,
  ).length;
  const evaluated = data.analytics.evals.evaluated;
  const evaluationCoverage = ratio(evaluated, data.voiceSessions.length);

  return (
    <section className="grid gap-5" data-command-center id="command-center">
      <section className="overflow-hidden rounded-2xl border border-sky-400/20 bg-[#0a101f] text-white shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)]">
        <div className="grid gap-6 bg-[radial-gradient(circle_at_top_right,rgba(61,102,176,0.45),transparent_42%)] p-5 sm:p-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={command.kpis.failedDelivery > 0 ? "red" : command.kpis.stale > 0 ? "amber" : "green"}>
                Live operating pulse
              </Badge>
              <span className="text-xs text-white/55">Snapshot {formatDate(data.generatedAt)}</span>
            </div>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              {command.kpis.active > 0
                ? `${command.kpis.active} open enquiries need a clear owner and outcome.`
                : "The enquiry pipeline is clear."}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65 sm:text-base">
              Start with the ranked queue, then use pipeline, account, delivery, and interaction evidence to make the
              next decision confidently.
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/[0.07] p-4" data-command-next-action>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">Do this next</div>
            {highest ? (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{highest.nextAction}</span>
                  <Badge tone={severityTone(highest.severity)}>{highest.severity}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-white/65">
                  {highest.lead.name || highest.lead.email} · {highest.lead.org || "Organisation not captured"}
                </p>
                <Link
                  className="mt-4 inline-flex h-10 items-center rounded-lg bg-slate-100 px-4 text-sm font-semibold text-slate-900 transition hover:bg-white/[0.06] hover:shadow-[0_0_24px_-6px_rgba(255,255,255,0.5)]"
                  href={recordHref(highest.lead.leadId)}
                >
                  Open highest-priority record <ArrowRightIcon className="ml-2 size-4" />
                </Link>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-white/65">No active enquiry currently needs operator action.</p>
            )}
          </div>
        </div>
      </section>

      <section
        aria-label="Executive enquiry metrics"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
        data-command-kpis
      >
        <ExecutiveMetric
          detail={`of ${command.kpis.total} saved`}
          icon={<SparklesIcon className="size-4" />}
          label="New today"
          spark={data.analytics.dailyLeads.map((day) => day.count)}
          tone="blue"
          value={String(command.kpis.newToday)}
        />
        <ExecutiveMetric
          detail={`${command.kpis.unassigned} unassigned`}
          icon={<UsersRoundIcon className="size-4" />}
          label="Open pipeline"
          tone={command.kpis.active > 0 ? "amber" : "green"}
          value={String(command.kpis.active)}
        />
        <ExecutiveMetric
          detail={`${command.kpis.active - command.kpis.unassigned}/${command.kpis.active} open assigned`}
          icon={<UserRoundCheckIcon className="size-4" />}
          label="Assignment"
          tone={metricTone(command.kpis.assignment, 90, 60)}
          value={formatPercent(command.kpis.assignment)}
        />
        <ExecutiveMetric
          detail={`${command.kpis.stale} outside 48h`}
          icon={<Clock3Icon className="size-4" />}
          label="SLA on track"
          tone={metricTone(command.kpis.sla, 80, 50)}
          value={formatPercent(command.kpis.sla)}
        />
        <ExecutiveMetric
          detail={`${command.kpis.failedDelivery} failed · ${command.kpis.deliveryPending} pending`}
          icon={<MailCheckIcon className="size-4" />}
          label="Delivery health"
          tone={command.kpis.failedDelivery > 0 ? "red" : metricTone(command.kpis.deliveryHealth, 90, 70)}
          value={formatPercent(command.kpis.deliveryHealth)}
        />
        <ExecutiveMetric
          detail="Confirmed pipeline outcomes"
          icon={<CheckCircle2Icon className="size-4" />}
          label="Qualified"
          tone={command.kpis.qualified > 0 ? "green" : "neutral"}
          value={String(command.kpis.qualified)}
        />
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.65fr)]">
        <section
          className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
          data-command-action-queue
        >
          <SectionHeader
            badge={`${command.attention.length} open`}
            detail="Ranked by delivery failure, urgency, ownership, SLA age, data gaps, and relationship context."
            eyebrow="Work queue"
            title="What needs attention now"
          />
          {command.attention.length === 0 ? (
            <EmptyState label="No active enquiries need attention." />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <caption className="sr-only">Oriental enquiries ranked by operator attention</caption>
                  <thead className="bg-[#0a0f1c]/85 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3" scope="col">
                        Priority
                      </th>
                      <th className="px-4 py-3" scope="col">
                        Customer
                      </th>
                      <th className="px-4 py-3" scope="col">
                        Why now
                      </th>
                      <th className="px-4 py-3" scope="col">
                        Owner &amp; age
                      </th>
                      <th className="px-4 py-3 text-right" scope="col">
                        Next action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {command.attention.slice(0, 8).map((item, index) => (
                      <AttentionTableRow
                        generatedAt={data.generatedAt}
                        index={index}
                        item={item}
                        key={item.lead.leadId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-white/10 md:hidden">
                {command.attention.slice(0, 8).map((item, index) => (
                  <AttentionMobileRow generatedAt={data.generatedAt} index={index} item={item} key={item.lead.leadId} />
                ))}
              </div>
            </>
          )}
          <div className="border-t border-white/10 bg-white/[0.02] px-4 py-3 text-right">
            <Link
              className="text-sm font-semibold text-sky-300 hover:underline"
              href="/admin/session-review?view=leads&sort=attention#crm-workspace"
            >
              Work the complete attention queue <ArrowRightIcon className="ml-1 inline size-4" />
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5" data-command-pipeline>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-sky-300">Pipeline health</div>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">Stage distribution</h3>
            </div>
            <Badge tone={command.kpis.unassigned > 0 ? "amber" : "green"}>{command.kpis.unassigned} unassigned</Badge>
          </div>
          <div className="mt-5 grid gap-4">
            {command.stages.map((stage) => (
              <div key={stage.status}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">{adminLeadStatusLabels[stage.status]}</span>
                  <span className="text-slate-400">
                    {stage.count} · {formatPercent(stage.percent)}
                  </span>
                </div>
                <ProgressBar
                  percent={stage.percent}
                  tone={stage.status === "qualified" ? "green" : stage.status === "archived" ? "neutral" : "blue"}
                />
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-4">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <CircleAlertIcon className="size-4" /> Primary bottleneck
            </div>
            <p className="mt-2 text-sm leading-6 text-amber-200/70">
              {command.kpis.unassigned > 0
                ? `${command.kpis.unassigned} open enquiries have no accountable owner; ${command.kpis.stale} are already outside the 48-hour review window.`
                : "Every open enquiry has an accountable owner. Keep the 48-hour review window healthy."}
            </p>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]" data-command-readiness>
          <SectionHeader
            badge={`${command.kpis.total} records`}
            detail="Completeness that directly affects routing, ownership, and follow-up quality."
            eyebrow="Data readiness"
            title="Can the team act without guessing?"
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {command.coverage.map((row) => (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4" key={row.key}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{row.label}</div>
                  <Badge tone={metricTone(row.percent, row.key === "phone" ? 40 : 85, row.key === "phone" ? 20 : 60)}>
                    {formatPercent(row.percent)}
                  </Badge>
                </div>
                <ProgressBar
                  percent={row.percent}
                  tone={row.percent !== null && row.percent >= 85 ? "green" : "amber"}
                />
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  {row.covered}/{row.total} · {row.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          className="overflow-hidden rounded-2xl border border-sky-400/25 bg-white/[0.04]"
          data-command-customer-intelligence
        >
          <SectionHeader
            badge={`${command.intelligence.uniqueOrganizationCount} accounts`}
            detail="Relationship signals derived from normalized organization and exact contact identity."
            eyebrow="Customer intelligence"
            title="Accounts, people, and repeat demand"
          />
          <div className="grid grid-cols-2 gap-px bg-white/10">
            <SignalMetric
              detail="Captured customer accounts"
              label="Organizations"
              value={command.intelligence.uniqueOrganizationCount}
            />
            <SignalMetric
              detail="Accounts with enquiry history"
              label="Multi-enquiry"
              value={command.intelligence.multiEnquiryAccountCount}
            />
            <SignalMetric
              detail="People who returned"
              label="Repeat contacts"
              value={command.intelligence.repeatContactCount}
            />
            <SignalMetric
              detail="Review-only, never auto-merged"
              label="Duplicate checks"
              value={command.intelligence.duplicateClusterCount}
            />
          </div>
          <div className="border-t border-white/10 px-5 py-4">
            <Link
              className="inline-flex items-center text-sm font-semibold text-sky-300 hover:underline"
              href="/admin/session-review?view=leads#crm-intelligence"
            >
              Open account portfolio <ArrowRightIcon className="ml-1.5 size-4" />
            </Link>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <MixPanel
          eyebrow="Acquisition"
          left={{
            title: "Source mix",
            rows: command.mixes.sources.map((row) => ({ ...row, label: sourceLabel(row.key) })),
          }}
          right={{
            title: "Enquiry intent",
            rows: command.mixes.segments.map((row) => ({ ...row, label: getSegment(row.key).label })),
          }}
          title="Where demand comes from"
        />
        <MixPanel
          eyebrow="Routing"
          left={{ title: "Team destinations", rows: command.mixes.routes.map((row) => ({ ...row, label: row.key })) }}
          right={{
            title: "Operational health",
            rows: [
              {
                key: "delivery",
                label: "Delivered",
                count: command.kpis.delivered,
                percent: command.kpis.deliveryHealth,
              },
              {
                key: "clickup",
                label: "ClickUp linked",
                count: command.coverage.find((row) => row.key === "clickup")?.covered ?? 0,
                percent: command.coverage.find((row) => row.key === "clickup")?.percent ?? null,
              },
              {
                key: "assigned",
                label: "Open assigned",
                count: command.kpis.active - command.kpis.unassigned,
                percent: command.kpis.assignment,
              },
            ],
          }}
          title="Where enquiries land"
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]" data-command-quality>
        <SectionHeader
          badge={`${evaluated} evaluated`}
          detail="Persisted interaction evidence. Higher is better except frustration, where lower is better."
          eyebrow="Reka quality"
          title="Conversation quality and recoverable demand"
        />
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
            <QualityMetric label="Routing" score={data.analytics.evals.averages?.routingCorrect} />
            <QualityMetric label="Capture" score={data.analytics.evals.averages?.captureCompleteness} />
            <QualityMetric label="Conversation" score={data.analytics.evals.averages?.conversationQuality} />
            <QualityMetric frustration label="Frustration" score={data.analytics.evals.averages?.frustration} />
          </div>
          <div className="grid gap-3 border-t border-white/10 bg-white/[0.02] p-5 xl:border-l xl:border-t-0">
            <QualityStatus
              detail={`${evaluated}/${data.voiceSessions.length} saved sessions`}
              label="Evaluation coverage"
              tone={metricTone(evaluationCoverage, 50, 20)}
              value={formatPercent(evaluationCoverage)}
            />
            <QualityStatus
              detail="Shared contact, no handoff"
              label="Recoverable voice leads"
              tone={recoverableVoice > 0 ? "amber" : "green"}
              value={String(recoverableVoice)}
            />
            <QualityStatus
              detail="Non-benign recent sessions"
              label="Runtime errors"
              tone={sessionsWithRealErrors > 0 ? "red" : "green"}
              value={String(sessionsWithRealErrors)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-white/10 px-5 py-4">
          <Link
            className="inline-flex items-center text-sm font-semibold text-sky-300 hover:underline"
            href="/admin/session-review?view=reka#reka-quality"
          >
            Open evaluation register <ArrowRightIcon className="ml-1.5 size-4" />
          </Link>
          <Link
            className="inline-flex items-center text-sm font-semibold text-sky-300 hover:underline"
            href="/admin/session-review?view=voice#voice-recovery"
          >
            Open recovery and diagnostics <ArrowRightIcon className="ml-1.5 size-4" />
          </Link>
        </div>
      </section>
    </section>
  );
}

function ExecutiveMetric({
  detail,
  icon,
  label,
  tone,
  value,
  spark,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  tone: AdminTone;
  value: string;
  spark?: number[];
}) {
  const toneClass = {
    neutral: "border-white/10 bg-white/[0.04]",
    blue: "border-sky-400/25 bg-sky-400/[0.06]",
    green: "border-emerald-400/25 bg-emerald-400/[0.04]",
    red: "border-rose-400/25 bg-rose-400/[0.04]",
    amber: "border-amber-400/25 bg-amber-400/[0.06]",
  }[tone];
  return (
    <article className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 text-slate-500">
        <span className="text-[10px] font-semibold uppercase tracking-[0.11em]">{label}</span>
        {icon}
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
      {spark && spark.length > 1 ? <MetricSparkline values={spark} /> : null}
    </article>
  );
}

// Tiny 7-day sparkline for KPI tiles (RSC-safe inline SVG).
function MetricSparkline({ values }: { values: number[] }) {
  const width = 100;
  const height = 22;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const line = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      className="mt-2 h-5 w-full text-sky-400"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>7-day lead volume</title>
      <polyline
        fill="none"
        points={line}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.8}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function SectionHeader({
  badge,
  detail,
  eyebrow,
  title,
}: {
  badge: string;
  detail: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-white/10 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-sky-300">{eyebrow}</div>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{detail}</p>
      </div>
      <Badge tone="blue">{badge}</Badge>
    </header>
  );
}

function AttentionTableRow({
  generatedAt,
  index,
  item,
}: {
  generatedAt: number;
  index: number;
  item: ReturnType<typeof buildAdminCommandCenter<LeadRow>>["attention"][number];
}) {
  const priority = normalizeAdminLeadPriority(item.lead.priority);
  return (
    <tr
      className={index === 0 ? "bg-sky-400/[0.06]" : "bg-white/[0.04] hover:bg-white/[0.02]"}
      data-lead-id={item.lead.leadId}
    >
      <td className="px-4 py-4 align-top">
        <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
      </td>
      <th className="px-4 py-4 font-normal align-top" scope="row">
        <div className="font-semibold">{item.lead.name || item.lead.email}</div>
        <div className="mt-1 text-xs text-slate-400">{item.lead.org || "Organisation not captured"}</div>
        <div className="mt-1 text-xs text-sky-300">
          {sourceLabel(item.lead.source)} · {getSegment(item.lead.segment).label}
        </div>
      </th>
      <td className="max-w-80 px-4 py-4 align-top">
        <div className="flex flex-wrap gap-1.5">
          {item.reasons.slice(0, 4).map((reason) => (
            <Badge key={reason.label} tone={reason.tone}>
              {reason.label}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="font-medium">{item.lead.owner?.trim() || "Unassigned"}</div>
        <div className="mt-1 text-xs text-slate-400">
          {formatAge(item.lead.createdAt, generatedAt)} · {adminLeadPriorityLabels[priority]}
        </div>
      </td>
      <td className="px-4 py-4 text-right align-top">
        <Link className="font-semibold text-sky-300 hover:underline" href={recordHref(item.lead.leadId)}>
          {item.nextAction}
        </Link>
      </td>
    </tr>
  );
}

function AttentionMobileRow({
  generatedAt,
  index,
  item,
}: {
  generatedAt: number;
  index: number;
  item: ReturnType<typeof buildAdminCommandCenter<LeadRow>>["attention"][number];
}) {
  return (
    <article className={`p-4 ${index === 0 ? "bg-sky-400/[0.06]" : "bg-white/[0.04]"}`} data-lead-id={item.lead.leadId}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{item.lead.name || item.lead.email}</div>
          <div className="mt-1 text-xs text-slate-400">
            {item.lead.org || "Organisation not captured"} · {formatAge(item.lead.createdAt, generatedAt)}
          </div>
        </div>
        <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.reasons.slice(0, 3).map((reason) => (
          <Badge key={reason.label} tone={reason.tone}>
            {reason.label}
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="text-slate-400">{item.lead.owner?.trim() || "Unassigned"}</span>
        <Link className="font-semibold text-sky-300" href={recordHref(item.lead.leadId)}>
          {item.nextAction}
        </Link>
      </div>
    </article>
  );
}

function ProgressBar({ percent, tone }: { percent: number | null; tone: "neutral" | "blue" | "green" | "amber" }) {
  const fill = { neutral: "bg-white/20", blue: "bg-sky-400", green: "bg-emerald-400", amber: "bg-amber-400" }[tone];
  return (
    <div
      aria-label={percent === null ? "Coverage unavailable" : `${percent}%`}
      className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.04]"
      role="img"
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent ?? 0}%` }} />
    </div>
  );
}

function SignalMetric({ detail, label, value }: { detail: string; label: string; value: number }) {
  return (
    <div className="bg-white/[0.04] p-5">
      <div className="text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">{label}</div>
      <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function MixPanel({
  eyebrow,
  left,
  right,
  title,
}: {
  eyebrow: string;
  left: MixColumn;
  right: MixColumn;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]" data-command-mix>
      <header className="border-b border-white/10 px-5 py-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-sky-300">{eyebrow}</div>
        <h3 className="mt-1 text-xl font-semibold tracking-tight">{title}</h3>
      </header>
      <div className="grid sm:grid-cols-2">
        <MixTable column={left} />
        <MixTable border column={right} />
      </div>
    </section>
  );
}

type MixColumn = { title: string; rows: Array<{ key: string; label: string; count: number; percent: number | null }> };

function MixTable({ border = false, column }: { border?: boolean; column: MixColumn }) {
  return (
    <div className={`min-w-0 p-5 ${border ? "border-t border-white/10 sm:border-l sm:border-t-0" : ""}`}>
      <h4 className="text-sm font-semibold">{column.title}</h4>
      <table className="mt-3 w-full border-collapse text-left text-sm">
        <caption className="sr-only">{column.title}</caption>
        <thead className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
          <tr>
            <th className="pb-2" scope="col">
              Group
            </th>
            <th className="pb-2 text-right" scope="col">
              Count
            </th>
            <th className="pb-2 text-right" scope="col">
              Share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {column.rows.slice(0, 6).map((row) => (
            <tr key={row.key}>
              <th className="py-2.5 font-medium" scope="row">
                {row.label}
              </th>
              <td className="py-2.5 text-right">{row.count}</td>
              <td className="py-2.5 text-right text-slate-400">{formatPercent(row.percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityMetric({
  frustration = false,
  label,
  score,
}: {
  frustration?: boolean;
  label: string;
  score?: number;
}) {
  const tone =
    score === undefined
      ? "neutral"
      : frustration
        ? score <= 2
          ? "green"
          : score <= 3
            ? "amber"
            : "red"
        : score >= 4
          ? "green"
          : score >= 3
            ? "amber"
            : "red";
  return (
    <div className="bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-500">{label}</div>
        <Badge tone={tone}>{score === undefined ? "--" : `${score.toFixed(2)}/5`}</Badge>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-400">
        {frustration ? "Lower is better · target ≤2" : "Higher is better · target ≥4"}
      </p>
    </div>
  );
}

function QualityStatus({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone: AdminTone;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-0.5 text-xs text-slate-400">{detail}</div>
      </div>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="p-8 text-center text-sm text-slate-400">{label}</div>;
}

function recordHref(leadId: string) {
  return `/admin/session-review?view=leads&sort=attention&lead=${encodeURIComponent(leadId)}#crm-record`;
}

function severityTone(severity: "critical" | "high" | "attention" | "routine"): AdminTone {
  if (severity === "critical") return "red";
  if (severity === "high") return "amber";
  if (severity === "attention") return "blue";
  return "neutral";
}

function metricTone(value: number | null, healthy: number, warning: number): AdminTone {
  if (value === null) return "neutral";
  if (value >= healthy) return "green";
  if (value >= warning) return "amber";
  return "red";
}

function formatPercent(value: number | null) {
  return value === null ? "--" : `${value}%`;
}

function ratio(numerator: number, denominator: number) {
  return denominator <= 0 ? null : Math.round((numerator / denominator) * 100);
}

function sourceLabel(source: string) {
  if (source === "voice") return "Reka voice";
  if (source === "hero-email") return "Email interest";
  if (source === "form") return "Website form";
  return source || "Unknown";
}

function formatAge(createdAt: number, generatedAt: number) {
  const hours = Math.max(Math.floor((generatedAt - createdAt) / (60 * 60 * 1000)), 0);
  if (hours < 1) return "<1h old";
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
