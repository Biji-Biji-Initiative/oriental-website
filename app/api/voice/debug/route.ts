import { isProductionEnv } from "@/lib/env";
import { type VoiceReviewSnapshotRequest, voiceReviewSnapshotSchema } from "@/lib/schemas";
import { persistVoiceReviewSnapshot } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
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
  logVoiceSessionHealth(parsed.data.review.id, parsed.data.snapshot);
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

const loggedErrorCounts = new Map<string, number>();
const loggedSubmissions = new Set<string>();

// Surface voice session health in structured server logs without captured PII or transcript text.
// Snapshots repost on every state change, so dedupe per review id.
function logVoiceSessionHealth(reviewId: string, snapshot: VoiceReviewSnapshotRequest["snapshot"]) {
  if (snapshot.errors.length > (loggedErrorCounts.get(reviewId) ?? 0)) {
    loggedErrorCounts.set(reviewId, snapshot.errors.length);
    trimToRecent(loggedErrorCounts);
    logWarn("voice_review.session_errors", {
      reviewId,
      sessionId: snapshot.sessionId,
      status: snapshot.status,
      connectionStatus: snapshot.connectionStatus,
      errorCount: snapshot.errors.length,
      errors: snapshot.errors.map((entry) => ({ code: entry.code, message: entry.message })),
    });
  }
  if (snapshot.status === "submitted" && !loggedSubmissions.has(reviewId)) {
    loggedSubmissions.add(reviewId);
    trimToRecent(loggedSubmissions);
    logInfo("voice_review.session_submitted", {
      reviewId,
      sessionId: snapshot.sessionId,
      leadId: snapshot.leadId ?? null,
      segment: snapshot.segment,
      transcriptTurns: snapshot.transcript.length,
      usage: snapshot.usage,
    });
  }
}

function trimToRecent(store: Map<string, number> | Set<string>, limit = 500) {
  for (const key of store.keys()) {
    if (store.size <= limit) break;
    store.delete(key);
  }
}
