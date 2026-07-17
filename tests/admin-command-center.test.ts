import { describe, expect, it } from "vitest";
import { buildAdminCommandCenter, type CommandCenterLeadLike } from "@/lib/admin-command-center";

const NOW = Date.parse("2026-07-16T16:30:00.000Z");

function lead(overrides: Partial<CommandCenterLeadLike> = {}): CommandCenterLeadLike {
  return {
    leadId: "lead-1",
    name: "Aisha",
    email: "aisha@example.com",
    org: "Mereka",
    phone: "+60123456789",
    message: "I want to run an education programme.",
    segment: "education",
    source: "voice",
    routedTo: "Lala",
    status: "new",
    priority: "normal",
    owner: "",
    notificationDelivered: true,
    notificationClickUpOk: true,
    createdAt: NOW - 60 * 60 * 1000,
    ...overrides,
  };
}

describe("admin command center", () => {
  it("ranks delivery failure ahead of urgent, stale, and routine work", () => {
    const result = buildAdminCommandCenter(
      [
        lead({ leadId: "routine", owner: "Nadia" }),
        lead({ leadId: "stale", createdAt: NOW - 8 * 24 * 60 * 60 * 1000 }),
        lead({ leadId: "urgent", priority: "urgent", owner: "Nadia" }),
        lead({ leadId: "failed", notificationDelivered: false, owner: "Nadia" }),
        lead({ leadId: "archived", status: "archived", notificationDelivered: false }),
      ],
      NOW,
    );

    expect(result.attention.map((item) => item.lead.leadId)).toEqual(["failed", "urgent", "stale", "routine"]);
    expect(result.attention[0]).toMatchObject({ severity: "critical", nextAction: "Recover delivery" });
    expect(result.attention[2]?.severity).toBe("attention");
    expect(result.attention[2]?.reasons.map((reason) => reason.label)).toContain("7d+ stale");
  });

  it("computes full-dataset KPIs, stage counts, readiness, and mixes", () => {
    const result = buildAdminCommandCenter(
      [
        lead(),
        lead({
          leadId: "lead-2",
          email: "returning@example.com",
          org: "Mereka!",
          owner: "Nadia",
          status: "contacted",
          source: "form",
          notificationDelivered: false,
        }),
        lead({
          leadId: "lead-3",
          email: "third@example.com",
          org: "",
          phone: "",
          message: "",
          owner: "Nadia",
          status: "qualified",
          notificationClickUpOk: false,
        }),
      ],
      NOW,
    );

    expect(result.kpis).toMatchObject({ active: 2, qualified: 1, unassigned: 1, failedDelivery: 1 });
    expect(result.kpis.assignment).toBe(50);
    expect(result.stages.find((stage) => stage.status === "new")?.count).toBe(1);
    expect(result.stages.find((stage) => stage.status === "contacted")?.count).toBe(1);
    expect(result.coverage.find((row) => row.key === "organization")).toMatchObject({
      covered: 2,
      total: 3,
      percent: 67,
    });
    expect(result.coverage.find((row) => row.key === "owner")).toMatchObject({ covered: 1, total: 2, percent: 50 });
    expect(result.mixes.sources.map((row) => [row.key, row.count])).toEqual([
      ["voice", 2],
      ["form", 1],
    ]);
    expect(result.intelligence.uniqueOrganizationCount).toBe(1);
  });

  it("uses the Kuala Lumpur calendar day for the new-today count", () => {
    const result = buildAdminCommandCenter(
      [
        lead({ leadId: "today", createdAt: Date.parse("2026-07-16T16:10:00.000Z") }),
        lead({ leadId: "yesterday", createdAt: Date.parse("2026-07-16T15:50:00.000Z") }),
      ],
      NOW,
    );

    expect(result.kpis.newToday).toBe(1);
  });

  it("renders unavailable ratios as null for an empty dataset", () => {
    const result = buildAdminCommandCenter([], NOW);
    expect(result.kpis.assignment).toBeNull();
    expect(result.kpis.sla).toBeNull();
    expect(result.kpis.deliveryHealth).toBeNull();
    expect(result.attention).toEqual([]);
  });
});
