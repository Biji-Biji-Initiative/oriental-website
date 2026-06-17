import { isProductionEnv } from "@/lib/env";
import { type VoiceReviewSnapshotRequest, voiceReviewSnapshotSchema } from "@/lib/schemas";
import { persistVoiceReviewSnapshot } from "@/lib/server/convex";
import { logInfo, logWarn } from "@/lib/server/logger";
import { sendOpsAlert } from "@/lib/server/ops-alerts";
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
    const reason = persistence?.reason ?? "unknown";
    logWarn("voice_review.persistence_failed", {
      reviewId: parsed.data.review.id,
      reason,
    });
    if (isProductionEnv()) {
      await sendOpsAlert({
        event: "voice_review.persistence_failed",
        severity: "error",
        summary: "A verified voice review snapshot failed to persist to Convex.",
        meta: { reviewId: parsed.data.review.id, sessionId: parsed.data.snapshot.sessionId, reason },
        fingerprint: reason,
      });
    }
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
const loggedSnapshotSignatures = new Map<string, string>();
const loggedSubmissions = new Set<string>();

// Surface voice session health in structured server logs without captured PII or transcript text.
// Snapshots repost on every state change, so dedupe per review id.
function logVoiceSessionHealth(reviewId: string, snapshot: VoiceReviewSnapshotRequest["snapshot"]) {
  const signature = buildHealthSnapshotSignature(snapshot);
  if (loggedSnapshotSignatures.get(reviewId) !== signature) {
    loggedSnapshotSignatures.set(reviewId, signature);
    trimToRecent(loggedSnapshotSignatures);
    const capturedFields = buildCapturedFieldSummary(snapshot.captured);
    const transcriptRoles = countTranscriptRoles(snapshot.transcript);
    logInfo("voice_review.session_snapshot", {
      reviewId,
      sessionId: snapshot.sessionId,
      leadId: snapshot.leadId ?? null,
      status: snapshot.status,
      connectionStatus: snapshot.connectionStatus,
      closeReason: snapshot.closeReason ?? null,
      prewarmedAt: snapshot.prewarmedAt ?? null,
      connectStartedAt: snapshot.connectStartedAt ?? null,
      connectedAt: snapshot.connectedAt ?? null,
      firstEventAt: snapshot.firstEventAt ?? null,
      closedAt: snapshot.closedAt ?? null,
      segment: snapshot.segment,
      model: snapshot.model ?? null,
      voice: snapshot.voice ?? null,
      speed: snapshot.speed ?? null,
      variant: snapshot.variant ?? null,
      transcriptTurns: snapshot.transcript.length,
      transcriptRoles,
      capturedFields,
      capturedFieldCount: Object.values(capturedFields).filter(Boolean).length,
      capturedMessageChars: snapshot.captured.message.length,
      routeRequested: snapshot.routeRequested,
      errorCount: snapshot.errors.length,
      rateLimitCount: snapshot.rateLimits.length,
      usage: snapshot.usage ?? null,
      submittedAt: snapshot.submittedAt ?? null,
    });
  }
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

function trimToRecent(
  store: { keys: () => IterableIterator<string>; readonly size: number; delete: (key: string) => boolean },
  limit = 500,
) {
  for (const key of store.keys()) {
    if (store.size <= limit) break;
    store.delete(key);
  }
}

function buildHealthSnapshotSignature(snapshot: VoiceReviewSnapshotRequest["snapshot"]) {
  return JSON.stringify({
    status: snapshot.status,
    connectionStatus: snapshot.connectionStatus,
    closeReason: snapshot.closeReason ?? null,
    prewarmedAt: snapshot.prewarmedAt ?? null,
    connectStartedAt: snapshot.connectStartedAt ?? null,
    connectedAt: snapshot.connectedAt ?? null,
    firstEventAt: snapshot.firstEventAt ?? null,
    closedAt: snapshot.closedAt ?? null,
    segment: snapshot.segment,
    model: snapshot.model ?? null,
    voice: snapshot.voice ?? null,
    speed: snapshot.speed ?? null,
    variant: snapshot.variant ?? null,
    transcriptTurns: snapshot.transcript.length,
    transcriptRoles: countTranscriptRoles(snapshot.transcript),
    capturedFields: buildCapturedFieldSummary(snapshot.captured),
    routeRequested: snapshot.routeRequested,
    errorCount: snapshot.errors.length,
    rateLimitCount: snapshot.rateLimits.length,
    usage: snapshot.usage ?? null,
    submitted: snapshot.status === "submitted",
  });
}

function buildCapturedFieldSummary(snapshot: VoiceReviewSnapshotRequest["snapshot"]["captured"]) {
  return {
    name: snapshot.name.trim().length > 0,
    email: snapshot.email.trim().length > 0,
    org: snapshot.org.trim().length > 0,
    phone: (snapshot.phone ?? "").trim().length > 0,
    website: (snapshot.website ?? "").trim().length > 0,
    message: snapshot.message.trim().length > 0,
  };
}

function countTranscriptRoles(snapshot: VoiceReviewSnapshotRequest["snapshot"]["transcript"]) {
  return snapshot.reduce(
    (counts, turn) => {
      counts[turn.role] += 1;
      return counts;
    },
    { user: 0, assistant: 0, system: 0 },
  );
}
