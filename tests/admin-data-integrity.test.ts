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
