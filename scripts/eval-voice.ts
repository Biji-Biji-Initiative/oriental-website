/**
 * Voice eval harness — scores the persisted Reka session corpus so every issue
 * feeds a measurable improvement loop.
 *
 * Usage (env-driven, run under Infisical so CONVEX/OPENAI creds are present):
 *   pnpm eval:voice                       # judge the last 50 sessions
 *   pnpm eval:voice -- --limit 100        # judge the last 100
 *   pnpm eval:voice -- --dry              # transport/latency/engagement signals only, no LLM
 *   pnpm eval:voice -- --aggregate-only   # query-only aggregate/gate JSON; no judge, mutation, or report
 *   pnpm eval:voice -- --min-quality 3.5 --max-dropped 0   # CI gate
 *   pnpm eval:voice -- --max-style-tics 0                  # ban known verbal tics
 *
 * Quota failures are hard-gated at zero by default. Override only when
 * reviewing a known historical incident; exhausted billing is never capacity.
 *
 * Guardrail: the JSON report (which contains transcripts) is written only to the
 * gitignored `eval-reports/` dir and is never committed. Console output is
 * aggregate-only — no transcript text.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { api } from "../convex/_generated/api";
import {
  aggregateEvals,
  aggregateEvalsByExperimentCell,
  aggregateEvalsByRuntimeProfile,
  assessLatencyAutopilotGate,
  buildJudgeUserPrompt,
  buildSessionEval,
  isJudgeable,
  isSyntheticVoiceSession,
  JUDGE_SYSTEM_PROMPT,
  type JudgeScore,
  meetsThreshold,
  mergeConversationSessions,
  parseJudgeResponse,
  piiFreeJudgeSummary,
  type SessionEval,
  type VoiceEvalSession,
  validateVoiceExperimentEvidence,
} from "../lib/eval/voice-eval";
import {
  deriveLegacyVoiceSubmissionEvidence,
  hasVoiceSubmissionEvidenceEnvelope,
  type ImmutableVoiceLeadEvidenceSource,
  verifyVoiceSubmissionEvidence,
} from "../lib/server/voice-submission-evidence";
import { buildAggregateOnlyVoiceEvalReport } from "./lib/voice-eval-audit";

type Args = {
  limit: number;
  dry: boolean;
  aggregateOnly: boolean;
  persist: boolean;
  out: string;
  minQuality?: number;
  minRouting?: number;
  maxFrustration?: number;
  maxDropped?: number;
  maxQuota: number;
  maxAvailability?: number;
  maxCaptureFailures?: number;
  maxStyleTics?: number;
};

const JUDGE_CONCURRENCY = 4;
const PROFILE_ENRICHMENT_CONCURRENCY = 8;
const IMMUTABLE_LEAD_ATTRIBUTION_LIMIT = 500;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 50,
    dry: false,
    aggregateOnly: false,
    persist: false,
    out: "eval-reports",
    maxQuota: 0,
  };
  let outWasExplicit = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--dry") {
      args.dry = true;
    } else if (flag === "--aggregate-only") {
      args.aggregateOnly = true;
    } else if (flag === "--persist") {
      args.persist = true;
    } else if (flag === "--limit") {
      args.limit = Number(value) || args.limit;
      i += 1;
    } else if (flag === "--out") {
      args.out = value ?? args.out;
      outWasExplicit = true;
      i += 1;
    } else if (flag === "--min-quality") {
      args.minQuality = Number(value);
      i += 1;
    } else if (flag === "--min-routing") {
      args.minRouting = Number(value);
      i += 1;
    } else if (flag === "--max-frustration") {
      args.maxFrustration = Number(value);
      i += 1;
    } else if (flag === "--max-dropped") {
      args.maxDropped = Number(value);
      i += 1;
    } else if (flag === "--max-quota") {
      args.maxQuota = Number(value);
      i += 1;
    } else if (flag === "--max-availability") {
      args.maxAvailability = Number(value);
      i += 1;
    } else if (flag === "--max-capture-failures") {
      args.maxCaptureFailures = Number(value);
      i += 1;
    } else if (flag === "--max-style-tics") {
      args.maxStyleTics = Number(value);
      i += 1;
    }
  }
  if (args.aggregateOnly && (args.persist || outWasExplicit)) {
    throw new Error("--aggregate-only cannot be combined with --persist or --out");
  }
  return args;
}

function requireEnv(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return unquote(value);
  }
  return null;
}

// Some Infisical values carry literal quote/shell-escape artifacts (e.g. a URL
// stored as `'\''https://...'\''`). Strip leading/trailing quote and backslash
// characters so URLs/secrets are usable verbatim.
function unquote(value: string): string {
  return value
    .trim()
    .replace(/^['"\\]+/, "")
    .replace(/['"\\]+$/, "");
}

async function judgeSession(client: OpenAI, model: string, session: VoiceEvalSession): Promise<JudgeScore | null> {
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: buildJudgeUserPrompt(session) },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    return content ? parseJudgeResponse(content) : null;
  } catch (error) {
    console.warn(`  ! judge failed for ${session.reviewId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Run an async mapper over items with a fixed concurrency. */
async function mapPool<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

type RawVoiceSessionProfile = {
  reviewId?: unknown;
  sessionId?: unknown;
  voice?: unknown;
  speed?: unknown;
  variant?: unknown;
};

/**
 * Keep aggregate audits read-only when a deployed bulk query predates profile
 * attribution. Its existing per-session query can enrich only missing fields;
 * no evaluator write or emergency Convex function deployment is needed.
 */
async function enrichVoiceSessionProfiles(
  convex: ConvexHttpClient,
  ingestSecret: string,
  sessions: VoiceEvalSession[],
  silent: boolean,
): Promise<VoiceEvalSession[]> {
  return mapPool(sessions, PROFILE_ENRICHMENT_CONCURRENCY, async (session) => {
    const needsProfile = session.voice == null || session.speed == null || typeof session.variant === "undefined";
    if (!needsProfile) return session;

    try {
      const raw = (await convex.query(api.leads.voiceSessionByReviewId, {
        ingestSecret,
        reviewId: session.reviewId,
      })) as RawVoiceSessionProfile | null;
      if (!raw) return session;
      return {
        ...session,
        voice: typeof raw.voice === "string" ? raw.voice : (session.voice ?? null),
        speed: typeof raw.speed === "number" && Number.isFinite(raw.speed) ? raw.speed : (session.speed ?? null),
        variant: typeof raw.variant === "string" || raw.variant === null ? raw.variant : (session.variant ?? null),
      };
    } catch (error) {
      if (!silent) {
        console.warn(
          `  ! profile attribution unavailable for ${session.reviewId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return session;
    }
  });
}

/**
 * Discover submissions from immutable routed leads, then join each lead to its
 * raw call row before reconnect rows are merged. This recovers attribution even
 * when the browser loses its fire-and-forget post-submit review snapshot.
 */
async function enrichSubmittedEmailAttribution(
  convex: ConvexHttpClient,
  ingestSecret: string,
  sessions: VoiceEvalSession[],
): Promise<VoiceEvalSession[]> {
  let rawLeads: ImmutableVoiceLeadEvidenceSource[];
  try {
    rawLeads = (await convex.query(api.leads.adminLeadTable, {
      ingestSecret,
      limit: IMMUTABLE_LEAD_ATTRIBUTION_LIMIT,
    })) as ImmutableVoiceLeadEvidenceSource[];
  } catch {
    throw new Error("Submitted email attribution query failed; capture-integrity evidence is unavailable.");
  }

  const sessionPairKeys = new Set(sessions.map((session) => submissionPairKey(session.reviewId, session.sessionId)));
  const sessionReviewIds = new Set(sessions.map((session) => session.reviewId));
  const sessionIds = new Set(sessions.map((session) => session.sessionId));
  const markedLeadIds = new Set(
    sessions.map((session) => session.leadId).filter((leadId): leadId is string => typeof leadId === "string"),
  );
  const leadsByPair = new Map<string, ImmutableVoiceLeadEvidenceSource[]>();
  const sessionWindowStart = evaluatedSessionWindowStart(sessions);
  const unmatchedEnvelopeLeads = rawLeads.filter((lead) => {
    const reviewId = typeof lead.voiceReviewId === "string" ? lead.voiceReviewId : null;
    const sessionId = typeof lead.voiceSessionId === "string" ? lead.voiceSessionId : null;
    const leadId = typeof lead.leadId === "string" ? lead.leadId : null;
    const overlapsEvaluatedSession =
      (reviewId !== null && sessionReviewIds.has(reviewId)) ||
      (sessionId !== null && sessionIds.has(sessionId)) ||
      (leadId !== null && markedLeadIds.has(leadId));
    if (overlapsEvaluatedSession || !hasVoiceSubmissionEvidenceEnvelope(lead)) return false;
    const leadCreatedAt = typeof lead.createdAt === "number" ? lead.createdAt : null;
    return (
      sessions.length === 0 ||
      sessionWindowStart === null ||
      leadCreatedAt === null ||
      leadCreatedAt >= sessionWindowStart
    );
  });
  const durableExcludedPairs = new Set(
    await mapPool(unmatchedEnvelopeLeads, PROFILE_ENRICHMENT_CONCURRENCY, async (lead) => {
      const reviewId = typeof lead.voiceReviewId === "string" ? lead.voiceReviewId : null;
      const sessionId = typeof lead.voiceSessionId === "string" ? lead.voiceSessionId : null;
      if (!reviewId || !sessionId) {
        throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
      }
      let raw: RawVoiceSessionProfile | null;
      try {
        raw = (await convex.query(api.leads.voiceSessionByReviewId, {
          ingestSecret,
          reviewId,
        })) as RawVoiceSessionProfile | null;
      } catch {
        throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
      }
      if (!raw || raw.reviewId !== reviewId || raw.sessionId !== sessionId) {
        throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
      }
      return submissionPairKey(reviewId, sessionId);
    }),
  );
  for (const lead of rawLeads) {
    const reviewId = typeof lead.voiceReviewId === "string" ? lead.voiceReviewId : null;
    const sessionId = typeof lead.voiceSessionId === "string" ? lead.voiceSessionId : null;
    const leadId = typeof lead.leadId === "string" ? lead.leadId : null;
    const overlapsEvaluatedSession =
      (reviewId !== null && sessionReviewIds.has(reviewId)) ||
      (sessionId !== null && sessionIds.has(sessionId)) ||
      (leadId !== null && markedLeadIds.has(leadId));
    if (!overlapsEvaluatedSession) {
      const leadCreatedAt = typeof lead.createdAt === "number" ? lead.createdAt : null;
      const orphanIsInWindow =
        hasVoiceSubmissionEvidenceEnvelope(lead) &&
        (sessions.length === 0 ||
          sessionWindowStart === null ||
          leadCreatedAt === null ||
          leadCreatedAt >= sessionWindowStart);
      const excludedPair = reviewId && sessionId ? submissionPairKey(reviewId, sessionId) : null;
      if (orphanIsInWindow && (!excludedPair || !durableExcludedPairs.has(excludedPair))) {
        throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
      }
      continue;
    }
    if (!reviewId || !sessionId || !sessionPairKeys.has(submissionPairKey(reviewId, sessionId))) {
      throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
    }
    const key = submissionPairKey(reviewId, sessionId);
    const matches = leadsByPair.get(key) ?? [];
    matches.push(lead);
    leadsByPair.set(key, matches);
  }

  return sessions.map((session) => {
    const markedSubmitted = typeof session.submittedAt === "number" || Boolean(session.leadId);
    const matches = leadsByPair.get(submissionPairKey(session.reviewId, session.sessionId)) ?? [];
    const lead = matches[0];
    if (matches.length === 0 && !markedSubmitted) return session;
    if (matches.length !== 1 || !lead || (session.leadId && lead.leadId !== session.leadId)) {
      throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
    }
    const hasEnvelope = hasVoiceSubmissionEvidenceEnvelope(lead);
    const verified = verifyVoiceSubmissionEvidence(lead);
    // The candidate staging path was introduced with v1 and must never count a
    // legacy snapshot as release evidence. Production rows created before that
    // rollout remain auditable under explicit legacy provenance.
    const legacyAllowed =
      !hasEnvelope &&
      session.modelCell !== "candidate" &&
      (session.deploymentEnvironment === "production" || session.deploymentEnvironment === "local");
    const evidence = verified ?? (legacyAllowed ? deriveLegacyVoiceSubmissionEvidence(lead) : null);
    if (!evidence) {
      throw new Error("Submitted email attribution is incomplete; capture-integrity evidence is unavailable.");
    }
    return {
      ...session,
      submittedAt: evidence.acceptedAt,
      submissionAuthorityTurnSequence: evidence.authorityTurnSequence,
      submissionEvidenceOutcome: evidence.outcome,
      submissionEvidenceProvenance: evidence.provenance,
      submissionEvidenceSource: evidence.source,
      ...(evidence.outcome === "matched" || evidence.outcome === "mismatched"
        ? { submittedEmailCorrectionAttribution: evidence.outcome }
        : {}),
    };
  });
}

function submissionPairKey(reviewId: string, sessionId: string) {
  return `${reviewId}\u0000${sessionId}`;
}

function evaluatedSessionWindowStart(sessions: VoiceEvalSession[]) {
  const timestamps = sessions.flatMap((session) => {
    const values = [session.createdAt, session.updatedAt, session.connectStartedAt, session.connectedAt];
    return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  });
  return timestamps.length > 0 ? Math.min(...timestamps) : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const convexUrl = requireEnv("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = requireEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) {
    console.error("Missing CONVEX_URL / CONVEX_INGEST_SECRET. Run under Infisical or export them first.");
    process.exit(1);
  }

  // Query logs are suppressed in aggregate-only mode so stdout remains one
  // machine-readable JSON document even if a Convex function emits log lines.
  const convex = new ConvexHttpClient(convexUrl, args.aggregateOnly ? { logger: false } : undefined);
  const fetchedSessions = (await convex.query(api.leads.voiceSessionsForEval, {
    ingestSecret,
    limit: args.limit,
  })) as VoiceEvalSession[];
  const customerRows = fetchedSessions.filter((session) => !isSyntheticVoiceSession(session));
  const rawSessions = await enrichVoiceSessionProfiles(convex, ingestSecret, customerRows, args.aggregateOnly);
  const syntheticRowsExcluded = fetchedSessions.length - customerRows.length;
  if (!args.aggregateOnly && syntheticRowsExcluded > 0) {
    console.log(`Excluded ${syntheticRowsExcluded} synthetic smoke row(s).`);
  }

  // Stitch dropped-and-resumed call rows into one conversation before judging,
  // so a single intake is scored once — not once per reconnect.
  const attributedRawSessions = await enrichSubmittedEmailAttribution(convex, ingestSecret, rawSessions);
  if (attributedRawSessions.length === 0 && !args.aggregateOnly) {
    console.log("No customer voice sessions to evaluate in this window.");
    return;
  }
  const mergedSessions = mergeConversationSessions(attributedRawSessions);
  const sessions = mergedSessions;
  const mergedCount = rawSessions.length - mergedSessions.length;
  if (!args.aggregateOnly && mergedCount > 0) {
    console.log(`Stitched ${rawSessions.length} call rows into ${sessions.length} conversations.`);
  }

  const openaiKey = args.aggregateOnly ? null : requireEnv("OPENAI_API_KEY");
  const model = process.env.EVAL_JUDGE_MODEL ?? "gpt-4o-mini";
  const dry = args.aggregateOnly || args.dry || !openaiKey;
  if (args.aggregateOnly) {
    // Aggregate-only is intentionally silent until the final JSON document.
  } else if (args.dry) console.log("Dry run: computing transport/latency/engagement signals only (no LLM judge).");
  else if (!openaiKey) console.warn("OPENAI_API_KEY not set — falling back to dry run (no LLM judge).");

  if (!args.aggregateOnly) {
    console.log(`Evaluating ${sessions.length} sessions${dry ? "" : ` with judge model ${model}`}...`);
  }

  const judgeable = sessions.filter(isJudgeable);
  const scores = new Map<string, JudgeScore | null>();
  if (!dry) {
    const client = new OpenAI({ apiKey: openaiKey ?? undefined });
    const judged = await mapPool(judgeable, JUDGE_CONCURRENCY, (session) => judgeSession(client, model, session));
    for (const [index, session] of judgeable.entries()) {
      scores.set(session.reviewId, judged[index] ?? null);
    }
  }

  const evals: SessionEval[] = sessions.map((session) =>
    buildSessionEval(session, scores.get(session.reviewId) ?? null),
  );
  const aggregate = aggregateEvals(evals);
  const profileAggregates = aggregateEvalsByRuntimeProfile(evals);
  const experimentAggregates = aggregateEvalsByExperimentCell(evals);
  const experimentValidation = validateVoiceExperimentEvidence(evals);
  const latencyAutopilotGate = assessLatencyAutopilotGate(sessions);

  if (args.persist && !dry) {
    const payloads = evals
      .filter((entry): entry is SessionEval & { score: NonNullable<SessionEval["score"]> } => entry.score !== null)
      .map((entry) => ({
        reviewId: entry.reviewId,
        routingCorrect: entry.score.routingCorrect,
        captureCompleteness: entry.score.captureCompleteness,
        conversationQuality: entry.score.conversationQuality,
        frustration: entry.score.frustration,
        summary: piiFreeJudgeSummary(entry.score),
        droppedMidTurn: entry.transport.droppedMidTurn,
        model,
      }));
    if (payloads.length > 0) {
      const result = await convex.mutation(api.leads.recordVoiceEvals, { ingestSecret, evals: payloads });
      console.log(`Persisted ${result.updated}/${payloads.length} eval scores to Convex.`);
    }
  }

  const thresholds = {
    minConversationQuality: args.minQuality,
    minRoutingCorrect: args.minRouting,
    maxFrustration: args.maxFrustration,
    maxDroppedMidTurn: args.maxDropped,
    maxQuotaFailures: args.maxQuota,
    maxAvailabilityFailures: args.maxAvailability,
    maxCaptureIntegrityFailures: args.maxCaptureFailures,
    maxStyleTicOccurrences: args.maxStyleTics,
  };
  const thresholdGate = meetsThreshold(aggregate, thresholds);
  const gate = {
    ok: thresholdGate.ok && experimentValidation.ok,
    failures: [...experimentValidation.failures, ...thresholdGate.failures],
  };

  if (args.aggregateOnly) {
    const report = buildAggregateOnlyVoiceEvalReport({
      generatedAt: new Date().toISOString(),
      queriedRows: fetchedSessions.length,
      syntheticRowsExcluded,
      customerCallRows: rawSessions.length,
      conversations: sessions.length,
      aggregate,
      profileAggregates,
      experimentAggregates,
      experimentValidation,
      latencyAutopilotGate,
      thresholdGate,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.gate.ok) process.exitCode = 2;
    return;
  }

  // Full report (with transcripts) → gitignored dir only.
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(args.out, `voice-eval-${stamp}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: stamp,
        syntheticRowsExcluded,
        aggregate,
        profileAggregates,
        experimentAggregates,
        experimentValidation,
        latencyAutopilotGate,
        evals,
        sessions,
      },
      null,
      2,
    ),
  );

  printSummary(aggregate, profileAggregates, experimentAggregates, latencyAutopilotGate, gate, reportPath, dry);

  const gateActive = Object.values(thresholds).some((value) => typeof value === "number");
  if (!experimentValidation.ok || (gateActive && !thresholdGate.ok)) process.exit(2);
}

function printSummary(
  aggregate: ReturnType<typeof aggregateEvals>,
  profileAggregates: ReturnType<typeof aggregateEvalsByRuntimeProfile>,
  experimentAggregates: ReturnType<typeof aggregateEvalsByExperimentCell>,
  latencyAutopilotGate: ReturnType<typeof assessLatencyAutopilotGate>,
  gate: { ok: boolean; failures: string[] },
  reportPath: string,
  dry: boolean,
) {
  const { averages } = aggregate;
  const fmt = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));
  console.log("\n=== Voice eval summary ===");
  console.log(`sessions:            ${aggregate.sessionCount}  (scored ${aggregate.scoredCount})`);
  console.log(`dropped mid-turn:    ${aggregate.droppedMidTurnCount}`);
  console.log(`disconnect sessions: ${aggregate.disconnectSessions}  (clean recoveries ${aggregate.cleanRecoveries})`);
  console.log(
    `availability failures: ${aggregate.availability.totalFailures}  ` +
      `(quota ${aggregate.availability.quotaFailures}, capacity ${aggregate.availability.capacityFailures}, transport ${aggregate.availability.transportFailures})`,
  );
  console.log(
    `capture integrity:     ${aggregate.captureIntegrity.totalFailures} failures across ` +
      `${aggregate.captureIntegrity.failedSessions} sessions ` +
      `(rejected ${aggregate.captureIntegrity.rejectedCaptures}, rejected email ${aggregate.captureIntegrity.rejectedEmailCaptures}, ` +
      `unconfirmed email ${aggregate.captureIntegrity.unconfirmedEmailFailures}, stale email submissions ${aggregate.captureIntegrity.staleEmailSubmissions}, ` +
      `unattributed email submissions ${aggregate.captureIntegrity.unattributedEmailSubmissions})`,
  );
  console.log(
    `conversation style:    ${aggregate.conversationStyle.bannedPhraseOccurrences} banned tic occurrences across ` +
      `${aggregate.conversationStyle.failedSessions} sessions`,
  );
  console.log(`submit rate:         ${(aggregate.submitRate * 100).toFixed(0)}%`);
  console.log(
    `tap to live p50/p95: ${fmtMs(aggregate.activation.tapToLiveP50Ms)} / ${fmtMs(aggregate.activation.tapToLiveP95Ms)} (${aggregate.activation.tapToLiveSamples} samples)`,
  );
  console.log(
    `tap to audible p50/p95: ${fmtMs(aggregate.activation.tapToAudibleP50Ms)} / ${fmtMs(aggregate.activation.tapToAudibleP95Ms)} (${aggregate.activation.tapToAudibleSamples} samples)`,
  );
  console.log(
    `useful start <=2s:    ${fmtRate(aggregate.activation.usefulStartRate)} (${aggregate.activation.usefulStartWithinTwoSeconds}/${aggregate.activation.attempts} explicitly marked post-mint attempts)`,
  );
  console.log(
    `availability failures: busy=${aggregate.availability.realtimeBusySessions} webrtc=${aggregate.availability.webrtcFailedSessions} remote-track-no-audio=${aggregate.availability.remoteTrackWithoutAudioSessions} retried=${aggregate.availability.retrySessions}`,
  );
  console.log(
    `evidence attribution: prod=${aggregate.attribution.environments.production} staging=${aggregate.attribution.environments.staging} local=${aggregate.attribution.environments.local} legacy-unknown=${aggregate.attribution.environments.unknown}; mobile=${aggregate.attribution.devices.mobile} desktop=${aggregate.attribution.devices.desktop} device-unknown=${aggregate.attribution.devices.unknown}`,
  );
  console.log("--- runtime profiles ---");
  for (const [profile, profileAggregate] of Object.entries(profileAggregates)) {
    console.log(
      `${profile}: ${profileAggregate.sessionCount} sessions, ${(profileAggregate.submitRate * 100).toFixed(0)}% submit, tap→live ${fmtMs(profileAggregate.activation.tapToLiveP50Ms)}/${fmtMs(profileAggregate.activation.tapToLiveP95Ms)} p50/p95`,
    );
  }
  console.log("--- runtime/model/reasoning cells ---");
  for (const [cell, cellAggregate] of Object.entries(experimentAggregates)) {
    console.log(
      `${cell}: ${cellAggregate.sessionCount} sessions, ${(cellAggregate.submitRate * 100).toFixed(0)}% submit, tap→live ${fmtMs(cellAggregate.activation.tapToLiveP50Ms)}/${fmtMs(cellAggregate.activation.tapToLiveP95Ms)} p50/p95`,
    );
  }
  console.log("--- latency promotion gate ---");
  console.log(`status:               ${latencyAutopilotGate.status}`);
  for (const reason of latencyAutopilotGate.missingEvidence) console.log(`  · ${reason}`);
  for (const failure of latencyAutopilotGate.failures) console.log(`  ✗ ${failure}`);
  if (!dry) {
    console.log("--- LLM rubric (0-5) ---");
    console.log(`routingCorrect:      ${fmt(averages.routingCorrect)}`);
    console.log(`captureCompleteness: ${fmt(averages.captureCompleteness)}`);
    console.log(`conversationQuality: ${fmt(averages.conversationQuality)}`);
    console.log(`frustration:         ${fmt(averages.frustration)} (lower is better)`);
  }
  if (aggregate.worstSessions.length > 0) {
    console.log("--- attention ---");
    for (const entry of aggregate.worstSessions) console.log(`  ${entry.reviewId}: ${entry.reason}`);
  }
  if (gate.failures.length > 0) {
    console.log("--- gate FAILED ---");
    for (const failure of gate.failures) console.log(`  ✗ ${failure}`);
  }
  console.log(`\nFull report: ${reportPath}`);
}

function fmtMs(value: number | null) {
  return value === null ? "n/a" : `${value}ms`;
}

function fmtRate(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value * 100)}%`;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
