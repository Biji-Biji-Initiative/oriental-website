import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const convexSource = readFileSync("convex/leads.ts", "utf8");
const schemaSource = readFileSync("convex/schema.ts", "utf8");
const tableSource = readFileSync("components/admin/AdminEnquiryDataTable.tsx", "utf8");

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

  it("computes canonical counts independently of the bounded row window", () => {
    const tableQuery = convexSource.slice(
      convexSource.indexOf("export const adminLeadTable"),
      convexSource.indexOf("export const adminLeadCounts"),
    );
    const countQuery = convexSource.slice(
      convexSource.indexOf("export const adminLeadCounts"),
      convexSource.indexOf("export const reviewDashboard"),
    );

    expect(tableQuery).toContain(".take(take)");
    expect(countQuery).toContain('ctx.db.query("leads").collect()');
    expect(countQuery).not.toContain(".take(");
  });

  it("retains archive and restore provenance on the canonical lead", () => {
    for (const field of ["archivedAt", "archivedBy", "archiveReason", "preArchiveStatus", "restoredAt", "restoredBy"]) {
      expect(schemaSource).toContain(`${field}: v.optional`);
    }
  });

  it("makes the no-data-loss behavior explicit in the operator UI", () => {
    const normalizedTableSource = tableSource.replace(/\s+/g, " ");
    expect(normalizedTableSource).toContain("No customer, transcript, delivery, or audit data is deleted.");
    expect(normalizedTableSource).toContain("archive or restore records without deleting customer evidence");
  });
});
