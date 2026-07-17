import { AlertTriangleIcon, ArrowUpRightIcon, CheckCircle2Icon, MessagesSquareIcon } from "lucide-react";
import { AdminRunEvalsButton } from "@/components/admin/AdminRunEvalsButton";
import { Badge } from "@/components/admin/Badge";

type EvalScore = {
  captureCompleteness: number;
  conversationQuality: number;
  droppedMidTurn: boolean;
  evaluatedAt: number;
  frustration: number;
  model: string;
  routingCorrect: number;
  summary: string;
};

type VoiceSession = {
  captured: {
    email?: string | null;
    message?: string | null;
    name?: string | null;
    org?: string | null;
  };
  eval?: EvalScore | null;
  leadId?: string | null;
  reviewId: string;
  segment: string;
  conversationId?: string | null;
  closeReason?: string | null;
  transcriptTurnCount?: number;
  updatedAt?: number;
};

/** Clean endings; anything else is a cutoff worth surfacing. */
const CLEAN_CLOSE_REASONS = new Set(["manual", "idle_timeout", "max_duration"]);

type ConversationContinuity = { calls: number; cutoffs: number };

function buildContinuity(sessions: VoiceSession[]) {
  const map = new Map<string, ConversationContinuity>();
  for (const session of sessions) {
    const key = session.conversationId ?? session.reviewId;
    const entry = map.get(key) ?? { calls: 0, cutoffs: 0 };
    entry.calls += 1;
    if (session.closeReason && !CLEAN_CLOSE_REASONS.has(session.closeReason)) entry.cutoffs += 1;
    map.set(key, entry);
  }
  return map;
}

function continuityFor(map: Map<string, ConversationContinuity>, session: VoiceSession) {
  return map.get(session.conversationId ?? session.reviewId) ?? { calls: 1, cutoffs: 0 };
}

type LeadReference = {
  email: string;
  leadId: string;
};

type EvalAverages = {
  captureCompleteness?: number | null;
  conversationQuality?: number | null;
  frustration?: number | null;
  routingCorrect?: number | null;
};

export function RekaQualityWorkspace({
  averages,
  droppedMidTurn,
  evaluated,
  leads,
  voiceSessions,
}: {
  averages?: EvalAverages | null;
  droppedMidTurn: number;
  evaluated: number;
  leads: LeadReference[];
  voiceSessions: VoiceSession[];
}) {
  const sessions = voiceSessions
    .filter((session): session is VoiceSession & { eval: EvalScore } => Boolean(session.eval))
    .sort((left, right) => right.eval.evaluatedAt - left.eval.evaluatedAt);
  const flagged = sessions.filter(needsReview);
  const continuity = buildContinuity(voiceSessions);
  // One entry per conversation awaiting a score: real turns, no eval on any call.
  const evaluatedConversations = new Set(sessions.map((s) => s.conversationId ?? s.reviewId));
  const awaitingByConversation = new Map<string, VoiceSession>();
  for (const session of voiceSessions) {
    const key = session.conversationId ?? session.reviewId;
    if (evaluatedConversations.has(key)) continue;
    if ((session.transcriptTurnCount ?? 0) === 0) continue;
    const current = awaitingByConversation.get(key);
    if (!current || (session.updatedAt ?? 0) > (current.updatedAt ?? 0)) awaitingByConversation.set(key, session);
  }
  const awaiting = [...awaitingByConversation.values()]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, 8);
  const coverage = voiceSessions.length > 0 ? Math.round((evaluated / voiceSessions.length) * 100) : 0;
  const dimensions = [
    {
      key: "routing",
      label: "Routing",
      value: averages?.routingCorrect ?? null,
      detail: "Was the visitor sent to the right Oriental team?",
      invert: false,
    },
    {
      key: "capture",
      label: "Capture",
      value: averages?.captureCompleteness ?? null,
      detail: "Did we retain enough contact, organisation, and request context?",
      invert: false,
    },
    {
      key: "quality",
      label: "Conversation",
      value: averages?.conversationQuality ?? null,
      detail: "Was the interaction clear, useful, and naturally directed?",
      invert: false,
    },
    {
      key: "frustration",
      label: "Frustration",
      value: averages?.frustration ?? null,
      detail: "How much friction did the visitor experience? Lower is better.",
      invert: true,
    },
  ];

  return (
    <section aria-label="Reka quality" className="grid scroll-mt-36 gap-5" id="reka-quality">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-300">Interaction quality</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Reka evaluations</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            A readable record of evaluated visitor conversations. Scores run from 1–5; higher is better except
            frustration, where lower is better.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">{evaluated} evaluated</Badge>
            <Badge tone={flagged.length > 0 ? "amber" : "green"}>{flagged.length} need review</Badge>
          </div>
          <AdminRunEvalsButton />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-xl border border-sky-400/25 bg-sky-400/10 p-4 text-white" data-eval-coverage>
          <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-white/60">Evaluation coverage</div>
          <div className="mt-2 text-3xl font-semibold">{coverage}%</div>
          <p className="mt-2 text-xs leading-5 text-white/65">
            {evaluated} of {voiceSessions.length} saved voice sessions have a persisted evaluation.
          </p>
        </article>
        {dimensions.map((dimension) => (
          <article
            className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
            data-eval-dimension={dimension.key}
            key={dimension.key}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">
                {dimension.label}
              </div>
              <Badge tone={scoreTone(dimension.value, dimension.invert)}>
                {dimension.value === null ? "Not scored" : `${dimension.value.toFixed(2)}/5`}
              </Badge>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">{dimension.detail}</p>
          </article>
        ))}
      </div>

      {awaiting.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-amber-400/20 bg-amber-400/[0.04]">
          <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.13em] text-amber-300">
                Awaiting evaluation
              </div>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">
                {awaiting.length === 8 ? "8+" : awaiting.length} conversation{awaiting.length === 1 ? "" : "s"} not yet
                scored
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                New conversations are scored automatically as calls close; anything left here can be scored on the spot.
              </p>
            </div>
            <AdminRunEvalsButton compact>Score all pending</AdminRunEvalsButton>
          </div>
          <div className="divide-y divide-white/5">
            {awaiting.map((session) => {
              const flow = continuityFor(continuity, session);
              return (
                <div className="flex flex-wrap items-center gap-3 px-5 py-3" key={session.reviewId}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {session.captured.name?.trim() || session.captured.email?.trim() || "Uncaptured visitor"}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {session.segment || "other"} · {session.transcriptTurnCount ?? 0} turns
                      {flow.calls > 1 ? ` · ${flow.calls} calls` : ""}
                    </span>
                  </span>
                  {flow.cutoffs > 0 ? (
                    <Badge tone="red">
                      {flow.cutoffs} cutoff{flow.cutoffs === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                  {session.closeReason && !CLEAN_CLOSE_REASONS.has(session.closeReason) ? (
                    <Badge tone="amber">{session.closeReason}</Badge>
                  ) : null}
                  <AdminRunEvalsButton compact reviewIds={[session.reviewId]}>
                    Evaluate
                  </AdminRunEvalsButton>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        <div className="flex flex-col gap-2 border-b border-white/10 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.13em] text-sky-300">Evaluation register</div>
            <h3 className="mt-1 text-xl font-semibold tracking-tight">Scored interactions</h3>
            <p className="mt-1 text-sm text-slate-400">
              Each row is one persisted evaluation, linked back to the CRM record.
            </p>
          </div>
          {droppedMidTurn > 0 ? (
            <Badge tone="red">
              <AlertTriangleIcon className="mr-1 size-3" /> {droppedMidTurn} dropped mid-turn
            </Badge>
          ) : (
            <Badge tone="green">
              <CheckCircle2Icon className="mr-1 size-3" /> No mid-turn drops
            </Badge>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No persisted interaction evaluations yet.</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1120px] border-collapse text-left text-sm" data-eval-table>
                <thead className="bg-white/[0.04] text-[11px] font-semibold uppercase tracking-[0.11em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Visitor</th>
                    <th className="px-3 py-3">Routing</th>
                    <th className="px-3 py-3">Capture</th>
                    <th className="px-3 py-3">Conversation</th>
                    <th className="px-3 py-3">Frustration</th>
                    <th className="px-3 py-3">Evaluation evidence</th>
                    <th className="px-3 py-3">Evaluated</th>
                    <th className="px-4 py-3 text-right">Record</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sessions.map((session) => (
                    <EvaluationTableRow
                      flow={continuityFor(continuity, session)}
                      key={session.reviewId}
                      leads={leads}
                      session={session}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid divide-y divide-white/5 lg:hidden">
              {sessions.map((session) => (
                <EvaluationCard key={session.reviewId} leads={leads} session={session} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreDefinition label="Routing" value="1 = wrong team · 5 = correct team and context" />
        <ScoreDefinition label="Capture" value="1 = little retained · 5 = follow-up-ready lead" />
        <ScoreDefinition label="Conversation" value="1 = unhelpful · 5 = clear, useful, natural" />
        <ScoreDefinition label="Frustration" value="1 = smooth · 5 = severe visitor friction" />
      </section>
    </section>
  );
}

function EvaluationTableRow({
  session,
  leads,
  flow,
}: {
  session: VoiceSession & { eval: EvalScore };
  leads: LeadReference[];
  flow: ConversationContinuity;
}) {
  const lead = matchingLead(session, leads);
  const flagged = needsReview(session);
  return (
    <tr className={flagged ? "bg-amber-500/[0.045] align-top" : "align-top hover:bg-white/[0.02]"}>
      <td className="px-4 py-4">
        <div className="font-semibold text-slate-100">{session.captured.name?.trim() || "Uncaptured visitor"}</div>
        <div className="mt-1 text-xs text-slate-400">{session.captured.email?.trim() || "Email not captured"}</div>
        <div className="mt-1 text-xs text-slate-400">{session.captured.org?.trim() || "Organisation not captured"}</div>
        {flow.calls > 1 || flow.cutoffs > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {flow.calls > 1 ? <Badge tone="blue">{flow.calls} calls</Badge> : null}
            {flow.cutoffs > 0 ? (
              <Badge tone="red">
                {flow.cutoffs} cutoff{flow.cutoffs === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </td>
      <ScoreCell invert={false} value={session.eval.routingCorrect} />
      <ScoreCell invert={false} value={session.eval.captureCompleteness} />
      <ScoreCell invert={false} value={session.eval.conversationQuality} />
      <ScoreCell invert value={session.eval.frustration} />
      <td className="max-w-[360px] px-3 py-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={flagged ? "amber" : "green"}>{flagged ? "Review" : "Healthy"}</Badge>
          <Badge tone="neutral">{session.segment || "Other"}</Badge>
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{session.eval.summary}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-4 text-xs text-slate-400">
        {formatAdminDate(session.eval.evaluatedAt)}
        <div className="mt-1">{session.eval.model}</div>
      </td>
      <td className="px-4 py-4 text-right">
        <RecordLink leadId={lead?.leadId} reviewId={session.reviewId} />
      </td>
    </tr>
  );
}

function EvaluationCard({ session, leads }: { session: VoiceSession & { eval: EvalScore }; leads: LeadReference[] }) {
  const lead = matchingLead(session, leads);
  const flagged = needsReview(session);
  return (
    <article className="grid gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{session.captured.name?.trim() || "Uncaptured visitor"}</div>
          <div className="mt-1 text-xs text-slate-400">{session.captured.email?.trim() || "Email not captured"}</div>
        </div>
        <Badge tone={flagged ? "amber" : "green"}>{flagged ? "Review" : "Healthy"}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MobileScore label="Routing" value={session.eval.routingCorrect} />
        <MobileScore label="Capture" value={session.eval.captureCompleteness} />
        <MobileScore label="Conversation" value={session.eval.conversationQuality} />
        <MobileScore invert label="Frustration" value={session.eval.frustration} />
      </div>
      <p className="text-xs leading-5 text-slate-400">{session.eval.summary}</p>
      <RecordLink leadId={lead?.leadId} reviewId={session.reviewId} />
    </article>
  );
}

function ScoreCell({ invert, value }: { invert: boolean; value: number }) {
  return (
    <td className="px-3 py-4">
      <Badge tone={scoreTone(value, invert)}>{value}/5</Badge>
    </td>
  );
}

function MobileScore({ invert = false, label, value }: { invert?: boolean; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <Badge tone={scoreTone(value, invert)}>{value}/5</Badge>
    </div>
  );
}

function RecordLink({ leadId, reviewId }: { leadId?: string; reviewId: string }) {
  const href = leadId
    ? `/admin/session-review?view=leads&lead=${encodeURIComponent(leadId)}#crm-record`
    : `/admin/session-review?view=voice#voice-${encodeURIComponent(reviewId)}`;
  return (
    <a className="inline-flex items-center text-xs font-semibold text-sky-300 hover:underline" href={href}>
      {leadId ? "Open CRM record" : "Open diagnostics"}
      <ArrowUpRightIcon className="ml-1 size-3" />
    </a>
  );
}

function ScoreDefinition({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <MessagesSquareIcon className="mt-0.5 size-4 shrink-0 text-sky-300" />
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.11em] text-slate-400">{label}</div>
        <div className="mt-1 text-xs leading-5 text-slate-400">{value}</div>
      </div>
    </div>
  );
}

function matchingLead(session: VoiceSession, leads: LeadReference[]) {
  if (session.leadId) {
    const match = leads.find((lead) => lead.leadId === session.leadId);
    if (match) return match;
  }
  const email = session.captured.email?.trim().toLowerCase();
  return email ? leads.find((lead) => lead.email.trim().toLowerCase() === email) : undefined;
}

function needsReview(session: VoiceSession & { eval: EvalScore }) {
  return session.eval.frustration >= 4 || session.eval.conversationQuality <= 2 || session.eval.droppedMidTurn;
}

function scoreTone(value: number | null, invert: boolean): "neutral" | "green" | "amber" | "red" {
  if (value === null) return "neutral";
  const normalized = invert ? 6 - value : value;
  if (normalized >= 4) return "green";
  if (normalized >= 3) return "amber";
  return "red";
}

function formatAdminDate(value: number) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
