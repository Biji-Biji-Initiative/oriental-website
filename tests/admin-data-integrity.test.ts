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
});
