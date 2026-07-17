import { INTAKE_ATTRIBUTION_FIELDS } from "./intake-attribution-analytics";

type IntakeField = (typeof INTAKE_ATTRIBUTION_FIELDS)[number];

type VoiceFieldProvenance = {
  method: string;
  correctionCount: number;
  clearCount: number;
};

type VoiceCaptureError = {
  code?: string;
  message: string;
};

export type VoiceCaptureSession = {
  reviewId: string;
  sessionId: string;
  conversationId?: string;
  leadId?: string | null;
  status: string;
  activationAttempted?: boolean;
  entryPoint?: string;
  entryMethod?: string;
  submissionMethod?: string;
  connectStartedAt?: number;
  connectedAt?: number;
  firstEventAt?: number;
  closedAt?: number;
  submittedAt?: number;
  followedUpAt?: number;
  routeRequested: boolean;
  captured: Partial<Record<IntakeField, string | undefined>>;
  fieldProvenance?: Partial<Record<IntakeField, VoiceFieldProvenance>>;
  emailVerification?: {
    status: "confirmed" | "pending";
    matchesCaptured: boolean;
  };
  transcript: Array<unknown>;
  errors: VoiceCaptureError[];
  createdAt: number;
  updatedAt: number;
};

type VoiceFieldCaptureSummary = {
  completedConversations: number;
  missingConversations: number;
  methodCounts: Record<string, number>;
  correctedConversations: number;
  correctionActions: number;
  clearedConversations: number;
  clearActions: number;
};

/**
 * The explicit activation bit and any visitor-entered field matter here: a
 * failed connection or a typed fallback is still a real intake attempt. A
 * permission-aware session mint with no subsequent activity is not.
 */
export function isEngagedVoiceCaptureSession(session: VoiceCaptureSession) {
  return Boolean(
    session.leadId ||
      typeof session.submittedAt === "number" ||
      session.activationAttempted === true ||
      typeof session.connectStartedAt === "number" ||
      typeof session.connectedAt === "number" ||
      typeof session.firstEventAt === "number" ||
      typeof session.closedAt === "number" ||
      session.transcript.length > 0 ||
      session.routeRequested ||
      INTAKE_ATTRIBUTION_FIELDS.some(
        (field) =>
          Boolean(session.captured[field]?.trim()) ||
          (session.fieldProvenance?.[field]?.correctionCount ?? 0) > 0 ||
          (session.fieldProvenance?.[field]?.clearCount ?? 0) > 0,
      ),
  );
}

/**
 * Build a PII-free funnel over the recent dashboard window. Realtime reconnects
 * are folded by conversationId. Legacy rows without that stable id remain
 * separate and are reported as unstitched rather than silently deduplicated by
 * contact details.
 */
export function summarizeVoiceCaptureFunnel(sessions: VoiceCaptureSession[], windowLimit: number) {
  const engaged = sessions.filter(isEngagedVoiceCaptureSession);
  const groups = groupLogicalConversations(engaged);
  const conversations = [...groups.values()].map(summarizeConversation);
  const fieldSummaries = Object.fromEntries(
    INTAKE_ATTRIBUTION_FIELDS.map((field) => [field, summarizeField(conversations, field)]),
  ) as Record<IntakeField, VoiceFieldCaptureSummary>;
  const submitted = conversations.filter((conversation) => conversation.submitted);
  const closedUnsubmitted = conversations.filter((conversation) => conversation.closed && !conversation.submitted);
  const openUnsubmitted = conversations.filter((conversation) => !conversation.closed && !conversation.submitted);

  return {
    cohort: {
      windowLimit,
      windowMayBeTruncated: sessions.length >= windowLimit,
      loadedSessionRows: sessions.length,
      engagedSessionRows: engaged.length,
      logicalConversations: conversations.length,
      stitchedConversations: conversations.filter((conversation) => conversation.stitched).length,
      unstitchedConversations: conversations.filter((conversation) => !conversation.stitched).length,
      foldedReconnectRows: Math.max(engaged.length - conversations.length, 0),
    },
    entryPointCounts: countBy(conversations, (conversation) => conversation.entryPoint ?? "unknown"),
    entryMethodCounts: countBy(conversations, (conversation) => conversation.entryMethod ?? "unknown"),
    submissionMethodCounts: countBy(submitted, (conversation) => conversation.submissionMethod ?? "unknown"),
    outcome: {
      submitted: submitted.length,
      closedUnsubmitted: closedUnsubmitted.length,
      openUnsubmitted: openUnsubmitted.length,
      abandonedBeforeEmail: closedUnsubmitted.filter((conversation) => !conversation.emailCaptured).length,
      closedWithEmailUnsent: closedUnsubmitted.filter((conversation) => conversation.emailCaptured).length,
    },
    email: {
      outcomes: {
        confirmed: conversations.filter((conversation) => conversation.emailOutcome === "confirmed").length,
        pending: conversations.filter((conversation) => conversation.emailOutcome === "pending").length,
        unverified: conversations.filter((conversation) => conversation.emailOutcome === "unverified").length,
        missing: conversations.filter((conversation) => conversation.emailOutcome === "missing").length,
      },
      signals: {
        rejectedCapture: conversations.filter((conversation) => conversation.rejectedEmailCapture).length,
        submitBlockedUnconfirmed: conversations.filter((conversation) => conversation.emailSubmitBlocked).length,
        recoverableConfirmed: closedUnsubmitted.filter(
          (conversation) =>
            !conversation.followedUp && conversation.emailOutcome === "confirmed" && conversation.emailCaptured,
        ).length,
        needsCheckBeforeFollowUp: closedUnsubmitted.filter(
          (conversation) =>
            !conversation.followedUp && conversation.emailCaptured && conversation.emailOutcome !== "confirmed",
        ).length,
      },
    },
    fields: fieldSummaries,
  };
}

function groupLogicalConversations(sessions: VoiceCaptureSession[]) {
  const groups = new Map<string, VoiceCaptureSession[]>();
  for (const session of sessions) {
    const conversationId = session.conversationId?.trim();
    const key = conversationId ? `conversation:${conversationId}` : `review:${session.reviewId}`;
    const group = groups.get(key);
    if (group) group.push(session);
    else groups.set(key, [session]);
  }
  return groups;
}

function summarizeConversation(group: VoiceCaptureSession[]) {
  const newestFirst = [...group].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt,
  );
  const latest = newestFirst[0] as VoiceCaptureSession;
  const submitted = group.some(
    (session) => Boolean(session.leadId) || typeof session.submittedAt === "number" || session.status === "submitted",
  );
  const emailCaptured = Boolean(latest.captured.email?.trim());
  const emailOutcome = !emailCaptured
    ? ("missing" as const)
    : latest.emailVerification?.status === "confirmed" && latest.emailVerification.matchesCaptured
      ? ("confirmed" as const)
      : latest.emailVerification?.status === "pending" || latest.emailVerification?.matchesCaptured === false
        ? ("pending" as const)
        : ("unverified" as const);

  return {
    stitched: Boolean(latest.conversationId?.trim()),
    submitted,
    closed: typeof latest.closedAt === "number",
    followedUp: group.some((session) => typeof session.followedUpAt === "number"),
    entryPoint: newestValue(newestFirst, (session) => session.entryPoint),
    entryMethod: newestValue(newestFirst, (session) => session.entryMethod),
    submissionMethod: newestValue(newestFirst, (session) => session.submissionMethod),
    captured: latest.captured,
    fieldProvenance: latest.fieldProvenance,
    maxFieldCounters: Object.fromEntries(
      INTAKE_ATTRIBUTION_FIELDS.map((field) => [
        field,
        {
          corrections: Math.max(...group.map((session) => session.fieldProvenance?.[field]?.correctionCount ?? 0)),
          clears: Math.max(...group.map((session) => session.fieldProvenance?.[field]?.clearCount ?? 0)),
        },
      ]),
    ) as Record<IntakeField, { corrections: number; clears: number }>,
    emailCaptured,
    emailOutcome,
    rejectedEmailCapture: group.some((session) => session.errors.some(isRejectedEmailCapture)),
    emailSubmitBlocked: group.some((session) =>
      session.errors.some((error) => error.code === "voice_email_unconfirmed"),
    ),
  };
}

function summarizeField(
  conversations: Array<ReturnType<typeof summarizeConversation>>,
  field: IntakeField,
): VoiceFieldCaptureSummary {
  const completed = conversations.filter((conversation) => Boolean(conversation.captured[field]?.trim()));
  const corrections = conversations.map((conversation) => conversation.maxFieldCounters[field].corrections);
  const clears = conversations.map((conversation) => conversation.maxFieldCounters[field].clears);
  return {
    completedConversations: completed.length,
    missingConversations: conversations.length - completed.length,
    methodCounts: countBy(completed, (conversation) => conversation.fieldProvenance?.[field]?.method ?? "unknown"),
    correctedConversations: corrections.filter((count) => count > 0).length,
    correctionActions: corrections.reduce((total, count) => total + count, 0),
    clearedConversations: clears.filter((count) => count > 0).length,
    clearActions: clears.reduce((total, count) => total + count, 0),
  };
}

function newestValue<T>(sessions: VoiceCaptureSession[], read: (session: VoiceCaptureSession) => T | undefined) {
  for (const session of sessions) {
    const value = read(session);
    if (value !== undefined) return value;
  }
  return undefined;
}

function isRejectedEmailCapture(error: VoiceCaptureError) {
  return (
    error.code === "voice_capture_rejected_email" ||
    (error.code === "voice_capture_rejected" && /(?:^|:)email(?:$|:)/i.test(error.message))
  );
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
