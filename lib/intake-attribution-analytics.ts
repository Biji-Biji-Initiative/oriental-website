export const INTAKE_ATTRIBUTION_FIELDS = ["name", "email", "org", "phone", "website", "message"] as const;

type FieldProvenanceEntry = {
  method: string;
  correctionCount: number;
  clearCount: number;
};

export type IntakeAttributionLead = {
  entryPoint?: string;
  entryMethod?: string;
  submissionMethod?: string;
  fieldProvenance?: Partial<Record<(typeof INTAKE_ATTRIBUTION_FIELDS)[number], FieldProvenanceEntry>>;
};

export function summarizeIntakeAttribution(leads: IntakeAttributionLead[]) {
  return {
    entryPointCounts: countBy(leads, (lead) => lead.entryPoint ?? "unknown"),
    entryMethodCounts: countBy(leads, (lead) => lead.entryMethod ?? "unknown"),
    submissionMethodCounts: countBy(leads, (lead) => lead.submissionMethod ?? "unknown"),
    entryPointSubmissionMatrix: attributionSubmissionMatrix(leads, (lead) => lead.entryPoint ?? "unknown"),
    entryMethodSubmissionMatrix: attributionSubmissionMatrix(leads, (lead) => lead.entryMethod ?? "unknown"),
    attributionCoverage: attributionCoverage(leads),
    fieldCompletionCounts: fieldCompletionCounts(leads),
    fieldCorrectionCounts: fieldCounterTotals(leads, "correctionCount"),
    fieldClearCounts: fieldCounterTotals(leads, "clearCount"),
  };
}

function countBy<T>(items: T[], key: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function attributionSubmissionMatrix(leads: IntakeAttributionLead[], group: (lead: IntakeAttributionLead) => string) {
  return leads.reduce<Record<string, Record<string, number>>>((matrix, lead) => {
    const entry = group(lead);
    const submission = lead.submissionMethod ?? "unknown";
    const row = matrix[entry] ?? {};
    row[submission] = (row[submission] ?? 0) + 1;
    matrix[entry] = row;
    return matrix;
  }, {});
}

function attributionCoverage(leads: IntakeAttributionLead[]) {
  const coverage = leads.reduce(
    (counts, lead) => {
      const present = [lead.entryPoint, lead.entryMethod, lead.submissionMethod, lead.fieldProvenance].filter(
        (value) => value !== undefined,
      ).length;
      if (present === 4) counts.complete += 1;
      else if (present === 0) counts.legacy += 1;
      else counts.partial += 1;
      return counts;
    },
    { complete: 0, partial: 0, legacy: 0 },
  );
  return {
    total: leads.length,
    ...coverage,
    completePercent: leads.length === 0 ? 0 : Math.round((coverage.complete / leads.length) * 1000) / 10,
  };
}

function fieldCompletionCounts(leads: IntakeAttributionLead[]) {
  return Object.fromEntries(
    INTAKE_ATTRIBUTION_FIELDS.map((field) => [
      field,
      countBy(leads, (lead) => lead.fieldProvenance?.[field]?.method ?? "unknown"),
    ]),
  );
}

function fieldCounterTotals(leads: IntakeAttributionLead[], counter: "correctionCount" | "clearCount") {
  return Object.fromEntries(
    INTAKE_ATTRIBUTION_FIELDS.map((field) => [
      field,
      leads.reduce((total, lead) => total + (lead.fieldProvenance?.[field]?.[counter] ?? 0), 0),
    ]),
  );
}
