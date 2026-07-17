import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import {
  buildJudgeUserPrompt,
  buildSessionEval,
  isJudgeable,
  isSyntheticVoiceSession,
  JUDGE_SYSTEM_PROMPT,
  type JudgeScore,
  mergeConversationSessions,
  parseJudgeResponse,
  type SessionEval,
  type VoiceEvalSession,
} from "@/lib/eval/voice-eval";

const JUDGE_CONCURRENCY = 3;
/** Hard ceiling per admin-triggered run so a single click cannot fan out unbounded model spend. */
export const MAX_ADMIN_EVAL_SESSIONS = 50;

export const DEFAULT_EVAL_JUDGE_MODEL = "gpt-4o-mini";

/** Small curated list the admin UI offers; env EVAL_JUDGE_MODEL stays the default. */
export const ADMIN_EVAL_MODEL_CHOICES = ["gpt-5.6-luna", "gpt-4o-mini"] as const;

const MODEL_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function configuredEvalJudgeModel() {
  return readEnv("EVAL_JUDGE_MODEL")?.trim() || DEFAULT_EVAL_JUDGE_MODEL;
}

export function isValidEvalModelId(model: string) {
  return MODEL_ID_PATTERN.test(model);
}

export type AdminEvalRunResult =
  | {
      ok: false;
      reason: "unconfigured" | "convex_failed" | "no_sessions";
      window?: { fetched: number; conversations: number; alreadyEvaluated: number };
    }
  | {
      ok: true;
      model: string;
      fetched: number;
      conversations: number;
      alreadyEvaluated: number;
      judged: number;
      persisted: number;
      failures: number;
      failureSamples: string[];
    };

/**
 * Judge persisted voice sessions with an LLM rubric and persist the scores.
 * Mirrors scripts/eval-voice.ts --persist, scoped for the admin runtime:
 * bounded batch, no report file, aggregate-only result (no transcript text).
 */
export async function runAdminVoiceEvals(options: {
  limit?: number;
  model?: string;
  reviewIds?: string[];
  /** Re-judge sessions that already have a persisted evaluation. */
  force?: boolean;
}): Promise<AdminEvalRunResult> {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  const openaiKey = readEnv("OPENAI_API_KEY");
  if (!convexUrl || !ingestSecret || !openaiKey) return { ok: false, reason: "unconfigured" };

  const model = options.model?.trim() || configuredEvalJudgeModel();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_ADMIN_EVAL_SESSIONS);
  const targetReviewIds = options.reviewIds?.length ? new Set(options.reviewIds) : null;

  const convex = new ConvexHttpClient(convexUrl);
  let fetchedSessions: VoiceEvalSession[];
  try {
    // Always fetch a wide window: `limit` bounds how many conversations we
    // JUDGE, never how far back we look. Recent rows are often judge-less
    // prewarms, so a narrow fetch silently starves the batch.
    fetchedSessions = (await convex.query(api.leads.voiceSessionsForEval, {
      ingestSecret,
      limit: MAX_ADMIN_EVAL_SESSIONS * 4,
    })) as VoiceEvalSession[];
  } catch {
    return { ok: false, reason: "convex_failed" };
  }

  const customerSessions = fetchedSessions.filter((session) => !isSyntheticVoiceSession(session));
  // Stitch dropped-and-resumed call rows into one conversation before judging,
  // so a single intake is scored once — not once per reconnect.
  const conversations = mergeConversationSessions(customerSessions).filter((session) => {
    if (!targetReviewIds) return true;
    if (targetReviewIds.has(session.reviewId)) return true;
    return (session.callReviewIds ?? []).some((id) => targetReviewIds.has(id));
  });
  const judgeableAll = conversations.filter(isJudgeable);
  // Untargeted runs spend tokens on NEW conversations only; a targeted run
  // (auto-eval on close, per-record button) re-judges so a resumed
  // conversation's score reflects the full stitched thread.
  const conversationEvaluated = (session: VoiceEvalSession & { callReviewIds?: string[] }) =>
    typeof session.evaluatedAt === "number" && session.evaluatedAt > 0;
  const pending =
    targetReviewIds || options.force ? judgeableAll : judgeableAll.filter((s) => !conversationEvaluated(s));
  const alreadyEvaluated = judgeableAll.length - (targetReviewIds || options.force ? 0 : pending.length);
  const judgeable = pending.slice(0, limit);
  if (judgeable.length === 0) {
    return {
      ok: false,
      reason: "no_sessions",
      window: { fetched: customerSessions.length, conversations: conversations.length, alreadyEvaluated },
    };
  }

  const client = new OpenAI({ apiKey: openaiKey });
  const scores = new Map<string, JudgeScore | null>();
  const failureSamples: string[] = [];
  await mapPool(judgeable, JUDGE_CONCURRENCY, async (session) => {
    const judged = await judgeSession(client, model, session);
    if (!judged.score && judged.error && failureSamples.length < 3) failureSamples.push(judged.error);
    scores.set(session.reviewId, judged.score);
  });

  const evals: SessionEval[] = judgeable.map((session) =>
    buildSessionEval(session, scores.get(session.reviewId) ?? null),
  );
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

  let persisted = 0;
  if (payloads.length > 0) {
    try {
      const result = (await convex.mutation(api.leads.recordVoiceEvals, { ingestSecret, evals: payloads })) as {
        updated: number;
      };
      persisted = result.updated;
    } catch {
      return { ok: false, reason: "convex_failed" };
    }
  }

  return {
    ok: true,
    model,
    fetched: customerSessions.length,
    conversations: conversations.length,
    alreadyEvaluated,
    judged: judgeable.length,
    persisted,
    failures: judgeable.length - payloads.length,
    failureSamples,
  };
}

async function judgeSession(
  client: OpenAI,
  model: string,
  session: VoiceEvalSession,
): Promise<{ score: JudgeScore | null; error?: string }> {
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
    const score = content ? parseJudgeResponse(content) : null;
    return score ? { score } : { score: null, error: "judge_response_unparseable" };
  } catch (error) {
    return { score: null, error: error instanceof Error ? error.message.slice(0, 160) : "judge_call_failed" };
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
