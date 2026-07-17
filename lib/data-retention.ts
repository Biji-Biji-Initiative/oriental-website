export const VOICE_ABANDONED_RETENTION_DAYS = 30;
export const VOICE_SUBMITTED_RETENTION_DAYS = 90;
export const ARCHIVED_LEAD_RETENTION_DAYS = 730;

export const RETENTION_BATCH_LIMITS = {
  expiredVoiceSessions: 24,
  expiredLeadTranscripts: 24,
  archivedLeads: 2,
  relatedRecordsPerLead: 24,
  legacyVoiceSessions: 4,
  legacyLeads: 4,
  privacyMatches: 100,
} as const;

export type PrivacyDeletionReason = "data_subject_request" | "consent_withdrawn" | "operator_correction";

export function retentionCutoffs(now: number) {
  return {
    abandonedVoiceBefore: now - daysToMs(VOICE_ABANDONED_RETENTION_DAYS),
    submittedVoiceBefore: now - daysToMs(VOICE_SUBMITTED_RETENTION_DAYS),
    archivedLeadBefore: now - daysToMs(ARCHIVED_LEAD_RETENTION_DAYS),
  };
}

export function voiceRetentionExpiresAt(input: {
  createdAt: number;
  submittedAt?: number;
  closedAt?: number;
  linked: boolean;
}) {
  const anchor = input.linked
    ? (input.submittedAt ?? input.closedAt ?? input.createdAt)
    : (input.closedAt ?? input.createdAt);
  return anchor + daysToMs(input.linked ? VOICE_SUBMITTED_RETENTION_DAYS : VOICE_ABANDONED_RETENTION_DAYS);
}

export function leadTranscriptRetentionExpiresAt(createdAt: number) {
  return createdAt + daysToMs(VOICE_SUBMITTED_RETENTION_DAYS);
}

export function archivedLeadRetentionExpiresAt(archivedAt: number) {
  return archivedAt + daysToMs(ARCHIVED_LEAD_RETENTION_DAYS);
}

function daysToMs(days: number) {
  return days * 24 * 60 * 60 * 1000;
}
