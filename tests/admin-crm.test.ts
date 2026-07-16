import { describe, expect, it } from "vitest";
import { buildCrmIntelligence, type CrmLeadLike, normalizeCrmSort, sortCrmLeads } from "@/lib/admin-crm";

const now = Date.UTC(2026, 6, 17, 0, 0, 0);

function lead(overrides: Partial<CrmLeadLike> & Pick<CrmLeadLike, "leadId">): CrmLeadLike {
  return {
    email: `${overrides.leadId}@example.test`,
    org: "Impact Lab",
    message: "We want to run a community workshop.",
    segment: "community",
    status: "new",
    priority: "normal",
    owner: "",
    createdAt: now - 60_000,
    ...overrides,
  };
}

describe("buildCrmIntelligence", () => {
  it("groups organizations and contacts without merging unrelated leads", () => {
    const result = buildCrmIntelligence(
      [
        lead({ leadId: "one", email: "person@example.test", org: "Impact Lab" }),
        lead({ leadId: "two", email: "person@example.test", org: "Impact Lab", createdAt: now - 120_000 }),
        lead({ leadId: "three", email: "other@example.test", org: "  Impact Lab!  ", createdAt: now - 180_000 }),
        lead({ leadId: "four", email: "solo@example.test", org: "", createdAt: now - 240_000 }),
      ],
      now,
    );

    expect(result.uniqueOrganizationCount).toBe(1);
    expect(result.multiEnquiryAccountCount).toBe(1);
    expect(result.repeatContactCount).toBe(1);
    expect(result.organizationCoverage).toBe(75);
    expect(result.accounts[0]).toMatchObject({ enquiryCount: 3, contactCount: 2, openCount: 3 });
    expect(result.relationships.get("one")?.relatedLeads.map((entry) => entry.leadId)).toEqual(["two", "three"]);
  });

  it("flags only same-contact, same-request submissions inside the duplicate window", () => {
    const result = buildCrmIntelligence(
      [
        lead({ leadId: "one", email: "person@example.test", createdAt: now - 2 * 60_000 }),
        lead({ leadId: "two", email: "PERSON@example.test", createdAt: now - 60_000 }),
        lead({
          leadId: "old",
          email: "person@example.test",
          createdAt: now - 60 * 60_000,
        }),
        lead({
          leadId: "different",
          email: "person@example.test",
          message: "A different request",
          createdAt: now - 30_000,
        }),
      ],
      now,
    );

    expect(result.duplicateClusterCount).toBe(1);
    expect([...result.duplicateLeadIds].sort()).toEqual(["one", "two"]);
    expect(result.relationships.get("one")?.possibleDuplicateCount).toBe(1);
    expect(result.relationships.get("old")?.possibleDuplicateCount).toBe(0);
  });

  it("summarizes unassigned and owned active workload", () => {
    const result = buildCrmIntelligence(
      [
        lead({ leadId: "new", priority: "urgent" }),
        lead({ leadId: "owned", owner: "Nadia", priority: "high", createdAt: now - 3 * 24 * 60 * 60_000 }),
        lead({ leadId: "closed", owner: "Nadia", status: "archived" }),
      ],
      now,
    );

    expect(result.ownerWorkloads).toEqual([
      expect.objectContaining({ owner: "Unassigned", openCount: 1, highPriorityCount: 1 }),
      expect.objectContaining({ owner: "Nadia", openCount: 1, highPriorityCount: 1, staleCount: 1 }),
    ]);
  });

  it("preserves non-ASCII organization names while normalizing punctuation", () => {
    const result = buildCrmIntelligence(
      [
        lead({ leadId: "one", org: "Kolej Élan 學院", createdAt: now - 2_000 }),
        lead({ leadId: "two", org: "  kolej élan 學院!  ", createdAt: now - 1_000 }),
      ],
      now,
    );

    expect(result.uniqueOrganizationCount).toBe(1);
    expect(result.accounts[0]).toMatchObject({ enquiryCount: 2, name: "kolej élan 學院!" });
  });
});

describe("sortCrmLeads", () => {
  const leads = [
    lead({ leadId: "recent", owner: "Nadia", createdAt: now - 10_000 }),
    lead({ leadId: "urgent", priority: "urgent", createdAt: now - 20_000 }),
    lead({ leadId: "failed", notificationDelivered: false, owner: "Chewi", createdAt: now - 30_000 }),
  ];

  it("keeps newest as the default and supports operator action sorting", () => {
    expect(sortCrmLeads(leads, "newest", now).map((entry) => entry.leadId)).toEqual(["recent", "urgent", "failed"]);
    expect(sortCrmLeads(leads, "attention", now).map((entry) => entry.leadId)).toEqual(["urgent", "failed", "recent"]);
    expect(sortCrmLeads(leads, "unassigned", now)[0]?.leadId).toBe("urgent");
  });

  it("normalizes unsupported query values", () => {
    expect(normalizeCrmSort("attention")).toBe("attention");
    expect(normalizeCrmSort("DROP TABLE")).toBe("newest");
  });
});
