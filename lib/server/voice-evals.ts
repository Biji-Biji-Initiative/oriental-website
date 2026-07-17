import { ConvexHttpClient } from "convex/browser";
import OpenAI from "openai";
import { api } from "@/convex/_generated/api";
import { readEnv } from "@/lib/env";
import { ADMIN_EVAL_MODEL_CHOICES, DEFAULT_EVAL_JUDGE_MODEL, isAllowedAdminEvalModel } from "@/lib/eval/admin-models";
import {
  buildJudgeUserPrompt,
  buildSessionEval,
  isJudgeable,
  isSyntheticVoiceSession,
  JUDGE_SYSTEM_PROMPT,
  type JudgeScore,
  mergeConversationSessions,
  parseJudgeResponse,
  piiFreeJudgeSummary,
  type SessionEval,
  type VoiceEvalSession,
} from "@/lib/eval/voice-eval";

const JUDGE_CONCURRENCY = 3;
const JUDGE_TIMEOUT_MS = 30_000;
const JUDGE_PHASE_BUDGET_MS = 60_000;
const ADMIN_EVAL_FETCH_WINDOW = 200;
/** Hard ceiling per admin-triggered run so a single click cannot fan out unbounded model spend. */
export const MAX_ADMIN_EVAL_SESSIONS = 12;
/**
 * A run must finish before its shared limiter lease expires. This prevents a
 * second request from starting while a slow first run is still spending.
 */
export const ADMIN_EVAL_RUN_DEADLINE_MS = 90_000;
export const ADMIN_EVAL_RUN_LEASE_MS = 5 * 60_000;
export const ADMIN_EVAL_FAILURE_CATEGORIES = [
  "run_deadline",
  "provider_timeout",
  "provider_rate_limited",
  "provider_auth",
  "provider_error",
  "empty_response",
  "invalid_response",
] as const;

export type AdminEvalFailureCategory = (typeof ADMIN_EVAL_FAILURE_CATEGORIES)[number];

export { ADMIN_EVAL_MODEL_CHOICES, DEFAULT_EVAL_JUDGE_MODEL };

export function configuredEvalJudgeModel() {
  return readEnv("EVAL_JUDGE_MODEL")?.trim() || DEFAULT_EVAL_JUDGE_MODEL;
}

export type AdminEvalRunResult =
  | {
      ok: false;
      reason: "unconfigured" | "invalid_model" | "convex_failed" | "no_sessions" | "deadline_exceeded";
    }
  | {
      ok: true;
      model: string;
      fetched: number;
      conversations: number;
      judged: number;
      persisted: number;
      failures: number;
      failureCategories: Record<AdminEvalFailureCategory, number>;
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
}): Promise<AdminEvalRunResult> {
  const convexUrl = readEnv("CONVEX_URL") ?? readEnv("NEXT_PUBLIC_CONVEX_URL");
  const ingestSecret = readEnv("CONVEX_INGEST_SECRET");
  const openaiKey = readEnv("OPENAI_API_KEY");
  if (!convexUrl || !ingestSecret || !openaiKey) return { ok: false, reason: "unconfigured" };

  const model = options.model?.trim() || configuredEvalJudgeModel();
  if (!isAllowedAdminEvalModel(model)) return { ok: false, reason: "invalid_model" };
  const limit = Math.min(Math.max(options.limit ?? 6, 1), MAX_ADMIN_EVAL_SESSIONS);
  const targetReviewIds = options.reviewIds?.length ? new Set(options.reviewIds) : null;
  const runController = new AbortController();
  const runTimer = setTimeout(() => runController.abort(new AdminEvalDeadlineError()), ADMIN_EVAL_RUN_DEADLINE_MS);

  try {
    const convex = new ConvexHttpClient(convexUrl);
    let fetchedSessions: VoiceEvalSession[];
    try {
      fetchedSessions = (await raceWithAbort(
        convex.query(api.leads.voiceSessionsForEval, {
          ingestSecret,
          // Always scan Convex's bounded window before filtering. Otherwise a
          // run of recently evaluated rows can starve older unscored sessions.
          limit: ADMIN_EVAL_FETCH_WINDOW,
        }) as Promise<VoiceEvalSession[]>,
        runController.signal,
      )) as VoiceEvalSession[];
    } catch (error) {
      return isAdminEvalDeadline(error)
        ? { ok: false, reason: "deadline_exceeded" }
        : { ok: false, reason: "convex_failed" };
    }

    const customerSessions = fetchedSessions.filter((session) => !isSyntheticVoiceSession(session));
    // Stitch dropped-and-resumed call rows into one conversation before judging,
    // so a single intake is scored once — not once per reconnect.
    const conversations = mergeConversationSessions(customerSessions).filter((session) => {
      if (!targetReviewIds) return true;
      if (targetReviewIds.has(session.reviewId)) return true;
      return (session.callReviewIds ?? []).some((id) => targetReviewIds.has(id));
    });
    const judgeable = conversations
      .filter(isJudgeable)
      .filter((session) => needsAdminEvaluation(session, model, Boolean(targetReviewIds)))
      .slice(0, limit);
    if (judgeable.length === 0) return { ok: false, reason: "no_sessions" };

    // One bounded retry absorbs a transient provider edge failure without turning
    // an operator click into a long retry storm. All calls also share a shorter
    // judge-phase budget, reserving time for the final Convex mutation.
    const client = new OpenAI({ apiKey: openaiKey, maxRetries: 1, timeout: JUDGE_TIMEOUT_MS });
    const judgeController = new AbortController();
    const abortJudgeWithRun = () => judgeController.abort(new AdminEvalDeadlineError());
    runController.signal.addEventListener("abort", abortJudgeWithRun, { once: true });
    const judgeTimer = setTimeout(() => judgeController.abort(new AdminEvalDeadlineError()), JUDGE_PHASE_BUDGET_MS);
    const outcomes = new Map<string, JudgeOutcome>();
    try {
      await mapPool(judgeable, JUDGE_CONCURRENCY, async (session) => {
        outcomes.set(session.reviewId, await judgeSession(client, model, session, judgeController.signal));
      });
    } finally {
      clearTimeout(judgeTimer);
      runController.signal.removeEventListener("abort", abortJudgeWithRun);
    }

    if (runController.signal.aborted) return { ok: false, reason: "deadline_exceeded" };
    const evals: SessionEval[] = judgeable.map((session) =>
      buildSessionEval(session, outcomes.get(session.reviewId)?.score ?? null),
    );
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

    let persisted = 0;
    if (payloads.length > 0) {
      try {
        const result = (await raceWithAbort(
          convex.mutation(api.leads.recordVoiceEvals, { ingestSecret, evals: payloads }) as Promise<{
            updated: number;
          }>,
          runController.signal,
        )) as { updated: number };
        persisted = result.updated;
      } catch (error) {
        return isAdminEvalDeadline(error)
          ? { ok: false, reason: "deadline_exceeded" }
          : { ok: false, reason: "convex_failed" };
      }
    }

    const failureCategories = Object.fromEntries(
      ADMIN_EVAL_FAILURE_CATEGORIES.map((category) => [
        category,
        [...outcomes.values()].filter((outcome) => outcome.failure === category).length,
      ]),
    ) as Record<AdminEvalFailureCategory, number>;

    return {
      ok: true,
      model,
      fetched: customerSessions.length,
      conversations: conversations.length,
      judged: judgeable.length,
      persisted,
      failures: judgeable.length - payloads.length,
      failureCategories,
    };
  } finally {
    clearTimeout(runTimer);
  }
}

/** Bulk runs are idempotent per judge model; an explicit target is a deliberate rescore. */
export function needsAdminEvaluation(session: VoiceEvalSession, model: string, targeted: boolean) {
  return targeted || session.eval?.model !== model;
}

type JudgeOutcome = { score: JudgeScore | null; failure?: AdminEvalFailureCategory };

async function judgeSession(
  client: OpenAI,
  model: string,
  session: VoiceEvalSession,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  if (signal.aborted) return { score: null, failure: "run_deadline" };
  try {
    const completion = await raceWithAbort(
      client.chat.completions.create(
        {
          model,
          temperature: 0,
          messages: [
            { role: "system", content: JUDGE_SYSTEM_PROMPT },
            { role: "user", content: buildJudgeUserPrompt(session) },
          ],
        },
        { signal },
      ),
      signal,
    );
    const content = completion.choices[0]?.message?.content;
    if (!content) return { score: null, failure: "empty_response" };
    const score = parseJudgeResponse(content);
    return score ? { score } : { score: null, failure: "invalid_response" };
  } catch (error) {
    if (signal.aborted) return { score: null, failure: "run_deadline" };
    return { score: null, failure: classifyJudgeError(error) };
  }
}

class AdminEvalDeadlineError extends Error {
  constructor() {
    super("Admin evaluation run exceeded its deadline");
    this.name = "AdminEvalDeadlineError";
  }
}

function isAdminEvalDeadline(error: unknown): boolean {
  return error instanceof AdminEvalDeadlineError;
}

/** Reject promptly when the shared run deadline expires; late promises are safely observed. */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new AdminEvalDeadlineError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new AdminEvalDeadlineError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function classifyJudgeError(error: unknown): AdminEvalFailureCategory {
  const candidate = error as { code?: unknown; name?: unknown; status?: unknown } | null;
  const status = typeof candidate?.status === "number" ? candidate.status : 0;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const name = typeof candidate?.name === "string" ? candidate.name.toLowerCase() : "";
  if (name.includes("timeout") || name === "aborterror" || code.includes("timeout") || code === "etimedout") {
    return "provider_timeout";
  }
  if (status === 429) return "provider_rate_limited";
  if (status === 401 || status === 403) return "provider_auth";
  return "provider_error";
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
