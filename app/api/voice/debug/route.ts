import { isProductionEnv } from "@/lib/env";
import { voiceReviewSnapshotSchema } from "@/lib/schemas";
import { persistVoiceReviewSnapshot } from "@/lib/server/convex";
import { logWarn } from "@/lib/server/logger";
import { noStoreJson } from "@/lib/server/security";
import { verifyVoiceReviewCredentials } from "@/lib/server/voice-review-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VoiceDebugEntry = {
  id: string;
  createdAt: string;
  payload: unknown;
};

const entries: VoiceDebugEntry[] = [];

function disabledResponse() {
  return noStoreJson({ ok: false, error: "not_found" }, { status: 404 });
}

export async function GET() {
  if (isProductionEnv()) return disabledResponse();
  return noStoreJson({ ok: true, entries });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = voiceReviewSnapshotSchema.safeParse(payload);
  if (!parsed.success) return noStoreJson({ ok: false, error: "invalid_payload" }, { status: 400 });
  const verified = verifyVoiceReviewCredentials(parsed.data.review.id, parsed.data.review.token);
  if (!verified && isProductionEnv()) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
  const snapshot = { ...parsed.data.snapshot, reviewId: parsed.data.review.id };
  const persistence = verified ? await persistVoiceReviewSnapshot(snapshot).catch(() => null) : null;
  if (verified && persistence?.ok !== true) {
    logWarn("voice_review.persistence_failed", {
      reviewId: parsed.data.review.id,
      reason: persistence?.reason ?? "unknown",
    });
  }
  entries.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload: { ...snapshot, review: { id: parsed.data.review.id } },
  });
  entries.splice(20);
  return noStoreJson({ ok: true, persisted: persistence?.ok === true });
}
