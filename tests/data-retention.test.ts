import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_LEAD_RETENTION_DAYS,
  retentionCutoffs,
  VOICE_ABANDONED_RETENTION_DAYS,
  VOICE_SUBMITTED_RETENTION_DAYS,
} from "@/lib/data-retention";

describe("data retention policy", () => {
  it("uses the published fixed windows", () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.UTC(2026, 6, 17);

    expect(retentionCutoffs(now)).toEqual({
      abandonedVoiceBefore: now - VOICE_ABANDONED_RETENTION_DAYS * day,
      submittedVoiceBefore: now - VOICE_SUBMITTED_RETENTION_DAYS * day,
      archivedLeadBefore: now - ARCHIVED_LEAD_RETENTION_DAYS * day,
    });
    expect([VOICE_ABANDONED_RETENTION_DAYS, VOICE_SUBMITTED_RETENTION_DAYS, ARCHIVED_LEAD_RETENTION_DAYS]).toEqual([
      30, 90, 730,
    ]);
  });

  it("keeps scheduled and subject deletion bounded on indexed records", () => {
    const convex = readFileSync("convex/leads.ts", "utf8");
    const schema = readFileSync("convex/schema.ts", "utf8");
    const scheduled = convex.slice(
      convex.indexOf("export const applyDataRetention"),
      convex.indexOf("export const deletePersonalData"),
    );
    const subject = convex.slice(
      convex.indexOf("export const deletePersonalData"),
      convex.indexOf("export const setVoiceSessionFollowUp"),
    );

    expect(schema).toContain('.index("by_safe_status_retention_expires_at"');
    expect(schema).toContain('.index("by_safe_retention_expires_at"');
    expect(schema).toContain('.index("by_retained_transcript_expires_at"');
    expect(schema).toContain('.index("by_lead_updated_at", ["leadId", "updatedAt"])');
    expect(schema).toContain('.index("by_captured_email_normalized", ["capturedEmailNormalized"])');
    expect(schema).toContain('.index("by_email_normalized", ["emailNormalized"])');
    expect(scheduled).toContain("RETENTION_BATCH_LIMITS.expiredVoiceSessions + 1");
    expect(scheduled).toContain("RETENTION_BATCH_LIMITS.legacyVoiceSessions + 1");
    expect(scheduled).toContain("RETENTION_BATCH_LIMITS.expiredLeadTranscripts + 1");
    expect(scheduled).toContain("RETENTION_BATCH_LIMITS.relatedRecordsPerLead");
    expect(scheduled).not.toContain(".filter(");
    expect(subject).toContain('.withIndex("by_email_normalized"');
    expect(subject).toContain('.withIndex("by_captured_email_normalized"');
    expect(subject).toContain("downstreamCleanupComplete");
    expect(subject).toContain("completed: complete");
    expect(subject).not.toContain("subjectFingerprint");
  });
});
