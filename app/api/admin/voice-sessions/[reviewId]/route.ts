import { adminVoiceFollowUpSchema } from "@/lib/schemas";
import { verifyAdminRequest } from "@/lib/server/admin-auth";
import { getAdminVoiceSession, setAdminVoiceFollowUp } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/admin/voice-sessions/[reviewId]">) {
  const auth = verifyAdminRequest(request);
  if (!auth.ok) {
    const status = auth.reason === "unconfigured" ? 503 : 401;
    return noStoreJson({ ok: false, error: auth.reason }, { status });
  }

  const { reviewId } = await context.params;
  const result = await getAdminVoiceSession(decodeURIComponent(reviewId)).catch((error) => {
    logWarn("admin_voice.detail_load_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 503;
    return noStoreJson({ ok: false, error: result.reason }, { status });
  }

  return noStoreJson({ ok: true, session: result.session });
}

export async function PATCH(request: Request, context: RouteContext<"/api/admin/voice-sessions/[reviewId]">) {
  const auth = verifyAdminRequest(request);
  if (!auth.ok) {
    const status = auth.reason === "unconfigured" ? 503 : 401;
    return noStoreJson({ ok: false, error: auth.reason }, { status });
  }

  const raw = await request.json().catch(() => null);
  const parsed = adminVoiceFollowUpSchema.safeParse(raw);
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_payload" }, { status: 400 });

  const { reviewId } = await context.params;
  const result = await setAdminVoiceFollowUp(decodeURIComponent(reviewId), parsed.data.followedUp).catch((error) => {
    logWarn("admin_voice.follow_up_update_failed", { error: error instanceof Error ? error.message : "unknown" });
    return { ok: false as const, reason: "convex_failed" };
  });

  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 503;
    return noStoreJson({ ok: false, error: result.reason }, { status });
  }

  logInfo("admin_voice.follow_up_updated", {
    reviewId: decodeURIComponent(reviewId),
    followedUp: parsed.data.followedUp,
  });

  return noStoreJson({ ok: true });
}
