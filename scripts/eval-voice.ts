/**
 * Voice eval harness — scores the persisted Reka session corpus so every issue
 * feeds a measurable improvement loop.
 *
 * Usage (env-driven, run under Infisical so CONVEX/OPENAI creds are present):
 *   pnpm eval:voice                       # judge the last 50 sessions
 *   pnpm eval:voice -- --limit 100        # judge the last 100
 *   pnpm eval:voice -- --dry              # transport/latency/engagement signals only, no LLM
 *   pnpm eval:voice -- --min-quality 3.5 --max-dropped 0   # CI gate
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
  JUDGE_SYSTEM_PROMPT,
  type JudgeScore,
  meetsThreshold,
  mergeConversationSessions,
  parseJudgeResponse,
  type SessionEval,
  type VoiceEvalSession,
} from "../lib/eval/voice-eval";

type Args = {
  limit: number;
  dry: boolean;
  persist: boolean;
  out: string;
  minQuality?: number;
  minRouting?: number;
  maxFrustration?: number;
  maxDropped?: number;
};

const JUDGE_CONCURRENCY = 4;

function parseArgs(argv: string[]): Args {
  const args: Args = { limit: 50, dry: false, persist: false, out: "eval-reports" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--dry") {
      args.dry = true;
    } else if (flag === "--persist") {
      args.persist = true;
    } else if (flag === "--limit") {
      args.limit = Number(value) || args.limit;
      i += 1;
    } else if (flag === "--out") {
      args.out = value ?? args.out;
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
    }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const convexUrl = requireEnv("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = requireEnv("CONVEX_INGEST_SECRET");
  if (!convexUrl || !ingestSecret) {
    console.error("Missing CONVEX_URL / CONVEX_INGEST_SECRET. Run under Infisical or export them first.");
    process.exit(1);
  }

  const convex = new ConvexHttpClient(convexUrl);
  const rawSessions = (await convex.query(api.leads.voiceSessionsForEval, {
    ingestSecret,
    limit: args.limit,
  })) as VoiceEvalSession[];

  if (rawSessions.length === 0) {
    console.log("No voice sessions to evaluate yet.");
    process.exit(0);
  }

  // Stitch dropped-and-resumed call rows into one conversation before judging,
  // so a single intake is scored once — not once per reconnect.
  const sessions = mergeConversationSessions(rawSessions);
  const mergedCount = rawSessions.length - sessions.length;
  if (mergedCount > 0) {
    console.log(`Stitched ${rawSessions.length} call rows into ${sessions.length} conversations.`);
  }

  const openaiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.EVAL_JUDGE_MODEL ?? "gpt-4o-mini";
  const dry = args.dry || !openaiKey;
  if (args.dry) console.log("Dry run: computing transport/latency/engagement signals only (no LLM judge).");
  else if (!openaiKey) console.warn("OPENAI_API_KEY not set — falling back to dry run (no LLM judge).");

  console.log(`Evaluating ${sessions.length} sessions${dry ? "" : ` with judge model ${model}`}...`);

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
        summary: entry.score.summary,
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
  };
  const gate = meetsThreshold(aggregate, thresholds);

  // Full report (with transcripts) → gitignored dir only.
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(args.out, `voice-eval-${stamp}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      { generatedAt: stamp, aggregate, profileAggregates, experimentAggregates, latencyAutopilotGate, evals, sessions },
      null,
      2,
    ),
  );

  printSummary(aggregate, profileAggregates, experimentAggregates, latencyAutopilotGate, gate, reportPath, dry);

  const gateActive = Object.values(thresholds).some((value) => typeof value === "number");
  if (gateActive && !gate.ok) process.exit(2);
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
  console.log(`submit rate:         ${(aggregate.submitRate * 100).toFixed(0)}%`);
  console.log("--- runtime profiles ---");
  for (const [profile, profileAggregate] of Object.entries(profileAggregates)) {
    console.log(
      `${profile}: ${profileAggregate.sessionCount} sessions, ${(profileAggregate.submitRate * 100).toFixed(0)}% submit`,
    );
  }
  console.log("--- model/reasoning cells ---");
  for (const [cell, cellAggregate] of Object.entries(experimentAggregates)) {
    console.log(
      `${cell}: ${cellAggregate.sessionCount} sessions, ${(cellAggregate.submitRate * 100).toFixed(0)}% submit`,
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

void main();
