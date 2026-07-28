import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const convexSource = readFileSync("convex/leads.ts", "utf8");
const schemaSource = readFileSync("convex/schema.ts", "utf8");
const tableSource = readFileSync("components/admin/AdminEnquiryDataTable.tsx", "utf8");
const workspaceSource = readFileSync("components/admin/EnquiryCrmWorkspace.tsx", "utf8");

describe("admin CRM data integrity contract", () => {
  it("implements archive as a reversible patch and never a hard delete", () => {
    const archiveMutation = convexSource.slice(
      convexSource.indexOf("export const archiveLeads"),
      convexSource.indexOf("function restorableStatus"),
    );

    expect(archiveMutation).toContain('action === "archive" ? "archived" : restoredStatus');
    expect(archiveMutation).toContain('kind: action === "archive" ? "workflow_archive" : "workflow_restore"');
    expect(archiveMutation).toContain("ctx.db.patch");
    expect(archiveMutation).not.toContain("ctx.db.delete");
  });

  it("blocks ordinary workflow updates at both sides of the archive boundary before any patch", () => {
    const workflowMutation = convexSource.slice(
      convexSource.indexOf("export const updateLeadWorkflow"),
      convexSource.indexOf("function auditChange"),
    );
    const boundaryGuard = workflowMutation.indexOf('status === "archived" || lead.status === "archived"');
    const firstPatch = workflowMutation.indexOf("ctx.db.patch");

    expect(boundaryGuard).toBeGreaterThan(-1);
    expect(firstPatch).toBeGreaterThan(boundaryGuard);
    expect(workflowMutation).toContain('reason: "archive_boundary"');
  });

  it("keeps count reads byte-safe and reports when totals are lower bounds", () => {
    const tableQuery = convexSource.slice(
      convexSource.indexOf("export const adminLeadTable"),
      convexSource.indexOf("export const adminLeadCounts"),
    );
    const countQuery = convexSource.slice(
      convexSource.indexOf("export const adminLeadCounts"),
      convexSource.indexOf("export const adminLeadSlaSnapshot"),
    );

    expect(tableQuery).toContain(".take(take)");
    expect(countQuery).toContain("requireIngestSecret(ingestSecret)");
    expect(countQuery).toContain('.withIndex("by_payload_safe_created_at"');
    expect(countQuery).toContain(".take(countLimit + 1)");
    expect(countQuery).toContain("truncated: leads.length > countLimit");
    expect(countQuery).not.toContain(".collect()");
    expect(workspaceSource).toContain("leadCounts.truncated === true");
    expect(workspaceSource).toContain("lowerBound={countsAreLowerBounds}");
    expect(tableSource).toContain('totalRowsLowerBound ? "≥" : ""');
  });

  it("checks SLA breaches through oldest-first bounded indexes and exposes overflow", () => {
    const slaQuery = convexSource.slice(
      convexSource.indexOf("export const adminLeadSlaSnapshot"),
      convexSource.indexOf("export const reviewDashboard"),
    );

    expect(schemaSource).toContain('.index("by_payload_safe_status_owner_created_at"');
    expect(schemaSource).toContain('.index("by_payload_safe_notification_delivered_created_at"');
    expect(slaQuery).toContain('.withIndex("by_payload_safe_status_owner_created_at"');
    expect(slaQuery).toContain('.withIndex("by_payload_safe_notification_delivered_created_at"');
    expect(slaQuery).toContain('.order("asc")');
    expect(slaQuery).toContain(".take(SLA_QUERY_BUCKET_LIMIT + 1)");
    expect(slaQuery).toContain("truncated:");
    expect(slaQuery).not.toContain(".collect()");
  });

  it("uses a materialized lifecycle index before applying the bounded orphan alert cap", () => {
    const recordMutation = convexSource.slice(
      convexSource.indexOf("export const recordVoiceSession"),
      convexSource.indexOf("export const applyDataRetention"),
    );
    const retentionMutation = convexSource.slice(
      convexSource.indexOf("export const applyDataRetention"),
      convexSource.indexOf("export const normalizeLegacyPrivacyEmails"),
    );
    const lifecycleBackfill = convexSource.slice(
      convexSource.indexOf("export const backfillVoiceSessionLifecycle"),
      convexSource.indexOf("export const normalizeLegacyPrivacyEmails"),
    );
    const orphanQuery = convexSource.slice(
      convexSource.indexOf("export const adminOrphanedVoiceSessionsSweep"),
      convexSource.indexOf("function summarizeSlaBuckets"),
    );
    const indexedLifecycle = orphanQuery.indexOf('.withIndex("by_safe_session_state_updated_at"');
    const boundedTake = orphanQuery.indexOf(".take(SLA_QUERY_BUCKET_LIMIT + 1)");

    expect(schemaSource).toContain(
      '.index("by_safe_session_state_updated_at", ["payloadSafe", "sessionState", "updatedAt"])',
    );
    expect(recordMutation).toContain(
      'const sessionState = closedAt ? "closed" : connectedAt ? "connected_open" : "preconnected"',
    );
    expect(recordMutation).toContain("sessionState,");
    expect(retentionMutation).toContain('.eq("sessionState", undefined)');
    expect(retentionMutation).toContain(
      'sessionState: session.closedAt ? "closed" : session.connectedAt ? "connected_open" : "preconnected"',
    );
    expect(lifecycleBackfill).not.toContain('.withIndex("by_payload_safe_updated_at"');
    expect(lifecycleBackfill).toContain('.withIndex("by_safe_session_state_updated_at"');
    expect(lifecycleBackfill).toContain(".take(take + 1)");
    expect(lifecycleBackfill.match(/ctx\.db\.patch/g)).toHaveLength(1);
    expect(lifecycleBackfill).toMatch(
      /ctx\.db\.patch\(session\._id,\s*\{\s*sessionState: session\.closedAt \? "closed" : session\.connectedAt \? "connected_open" : "preconnected",\s*\}\);/,
    );
    expect(lifecycleBackfill).not.toContain("captured:");
    expect(lifecycleBackfill).not.toContain("capturedEmailNormalized:");
    expect(lifecycleBackfill).not.toContain("transcript:");
    expect(lifecycleBackfill).not.toContain("payloadSafe:");
    expect(lifecycleBackfill).not.toContain("retentionExpiresAt:");
    expect(lifecycleBackfill).not.toContain("ctx.db.delete");
    expect(indexedLifecycle).toBeGreaterThan(-1);
    expect(orphanQuery).toContain('.eq("sessionState", "connected_open").lt("updatedAt", staleCutoff)');
    expect(boundedTake).toBeGreaterThan(indexedLifecycle);
    expect(orphanQuery).toContain('.eq("sessionState", undefined)');
    expect(orphanQuery).toContain('.withIndex("by_payload_safe_updated_at"');
    expect(orphanQuery).toContain('.eq("payloadSafe", undefined)');
    expect(orphanQuery).toContain('.eq("sessionState", undefined)');
    expect(orphanQuery).toContain("migrationPending: legacyPayloads.length > 0 || legacyStates.length > 0");
    const migrationPending = (legacyPayloads: unknown[], legacyStates: unknown[]) =>
      legacyPayloads.length > 0 || legacyStates.length > 0;
    expect(migrationPending([{}], [])).toBe(true);
    expect(migrationPending([], [{}])).toBe(true);
    expect(migrationPending([], [])).toBe(false);
    expect(orphanQuery).not.toContain("lookbackCutoff");
    expect(orphanQuery).not.toContain(".filter(");
    expect(orphanQuery).not.toContain(".collect()");
  });

  it("excludes unmigrated oversized payloads from dashboard, eval, and count scans", () => {
    const evalQuery = convexSource.slice(
      convexSource.indexOf("export const voiceSessionsForEval"),
      convexSource.indexOf("export const recent"),
    );
    const countQuery = convexSource.slice(
      convexSource.indexOf("export const adminLeadCounts"),
      convexSource.indexOf("export const adminLeadSlaSnapshot"),
    );
    const dashboardQuery = convexSource.slice(
      convexSource.indexOf("export const reviewDashboard"),
      convexSource.indexOf("function toVoiceSessionSummary"),
    );

    expect(evalQuery).toContain('.withIndex("by_payload_safe_updated_at"');
    expect(countQuery).toContain('.withIndex("by_payload_safe_created_at"');
    expect(dashboardQuery).toContain('.withIndex("by_payload_safe_created_at"');
    expect(dashboardQuery).toContain('.withIndex("by_payload_safe_updated_at"');
  });

  it("retains archive and restore provenance on the canonical lead", () => {
    for (const field of ["archivedAt", "archivedBy", "archiveReason", "preArchiveStatus", "restoredAt", "restoredBy"]) {
      expect(schemaSource).toContain(`${field}: v.optional`);
    }
  });

  it("makes the no-data-loss behavior explicit in the operator UI", () => {
    const normalizedTableSource = tableSource.replace(/\s+/g, " ");
    expect(normalizedTableSource).toContain("Archiving does not delete them now");
    expect(normalizedTableSource).toContain("published two-year retention window");
    expect(normalizedTableSource).toContain(
      "archive or restore records without deleting customer evidence immediately",
    );
  });

  it("strips server-owned submission evidence before lead rows cross into the client table", () => {
    expect(workspaceSource).toContain("utm: publicLeadUtm(lead.utm)");
  });
});
