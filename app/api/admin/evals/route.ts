import { z } from "zod";
import { isAllowedAdminEvalModel } from "@/lib/eval/admin-models";
import { adminAuthFailureStatus, verifyAdminPermission } from "@/lib/server/admin-auth";
import { logInfo, logWarn } from "@/lib/server/logger";
import { checkRateLimit, noStoreJson, rateLimitResponseHeaders } from "@/lib/server/security";
import {
  ADMIN_EVAL_RUN_LEASE_MS,
  type AdminEvalRunResult,
  MAX_ADMIN_EVAL_SESSIONS,
  runAdminVoiceEvals,
} from "@/lib/server/voice-evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  model: z.string().trim().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(MAX_ADMIN_EVAL_SESSIONS).optional(),
  reviewIds: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = verifyAdminPermission(request, "evals.run");
  if (!auth.ok) {
    return noStoreJson({ ok: false, error: auth.reason }, { status: adminAuthFailureStatus(auth) });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  if (parsed.data.model && !isAllowedAdminEvalModel(parsed.data.model)) {
    return noStoreJson({ ok: false, error: "invalid_model" }, { status: 400 });
  }

  // One global run per environment at a time/window. Production's Redis-backed
  // limiter makes this atomic across app workers; local memory is a safe fallback.
  const limit = await checkRateLimit("admin-evals:run", 1, ADMIN_EVAL_RUN_LEASE_MS);
  if (!limit.ok) {
    logWarn("admin_evals.rate_limited", { actor: auth.actor, rateLimitStore: limit.store });
    return noStoreJson(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: rateLimitResponseHeaders(limit.resetAt) },
    );
  }

  const result = await runAdminVoiceEvals(parsed.data).catch((error): AdminEvalRunResult => {
    logWarn("admin_evals.run_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false, reason: "convex_failed" };
  });

  if (!result.ok) {
    // Every outcome is telemetry: a silent non-ok is indistinguishable from
    // "nobody clicked the button" when diagnosing coverage gaps.
    logWarn("admin_evals.not_run", { actor: auth.actor, reason: result.reason, ...result.window });
    const status =
      result.reason === "unconfigured" || result.reason === "invalid_model"
        ? 503
        : result.reason === "deadline_exceeded"
          ? 504
          : result.reason === "no_sessions"
            ? 404
            : 502;
    return noStoreJson(
      { ok: false, error: result.reason, ...(result.window ? { window: result.window } : {}) },
      { status },
    );
  }

  logInfo("admin_evals.completed", {
    actor: auth.actor,
    model: result.model,
    judged: result.judged,
    persisted: result.persisted,
    failures: result.failures,
    alreadyEvaluated: result.alreadyEvaluated,
    failureCategories: result.failureCategories,
    failureSamples: result.failureSamples,
  });
  const { ok: _ok, ...summary } = result;
  return noStoreJson({ ok: true, ...summary });
}
