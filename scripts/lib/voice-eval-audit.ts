import type { EvalAggregate, LatencyAutopilotGate, VoiceExperimentEvidenceValidation } from "../../lib/eval/voice-eval";

export type AggregateOnlyEvalAggregate = Omit<EvalAggregate, "worstSessions">;

export type AggregateOnlyGate = { ok: boolean; failures: string[] };

export type AggregateOnlySyntheticPipeline = {
  aggregate: AggregateOnlyEvalAggregate;
  status: "pass" | "fail" | "insufficient_data";
  failures: string[];
};

export type AggregateOnlyHistoricalEvidenceDebt = {
  scope: "bounded-pre-cohort-target-cell";
  complete: boolean;
  validV1: number;
  missingV1Envelope: number;
  invalidV1Envelope: number;
  unresolvedJoin: number;
  affectsReleaseGate: false;
};

export type AggregateOnlyVoiceEvalReport = {
  schemaVersion: 2;
  mode: "aggregate-only";
  generatedAt: string;
  source: {
    requestedLimit: number;
    serverCap: 200;
    queryOrder: "updatedAt_desc";
    queriedRows: number;
    oldestFetchedUpdatedAt: number | null;
    windowComplete: boolean | null;
    leadRowsQueried: number;
    leadCap: 500;
    leadWindowMayBeTruncated: boolean;
    syntheticRowsExcluded: number;
    customerCallRows: number;
    conversations: number;
  };
  cohort: {
    enabled: boolean;
    startAt: string | null;
    environment: "local" | "staging" | "production" | null;
    targetModelCell: "control" | "candidate" | null;
    customerCallRows: number;
    customerConversations: number;
    targetConversations: number;
    syntheticCallRows: number;
    syntheticConversations: number;
    preCohortRowsExcluded: number;
    otherEnvironmentRowsExcluded: number;
    crossBoundaryRowsExcluded: number;
  };
  aggregate: AggregateOnlyEvalAggregate;
  profileAggregates: Record<string, AggregateOnlyEvalAggregate>;
  experimentAggregates: Record<string, AggregateOnlyEvalAggregate>;
  experimentValidation: {
    ok: boolean;
    invalidConversationCount: number;
    failures: string[];
  };
  latencyAutopilotGate: LatencyAutopilotGate;
  syntheticPipeline: AggregateOnlySyntheticPipeline;
  historicalEvidenceDebt: AggregateOnlyHistoricalEvidenceDebt;
  promotionEvidence: {
    experimentValidation: AggregateOnlyVoiceEvalReport["experimentValidation"];
    latencyAutopilotGate: LatencyAutopilotGate;
  };
  gates: {
    releaseQuality: AggregateOnlyGate;
    syntheticPipeline: AggregateOnlyGate;
    overall: AggregateOnlyGate;
  };
  /** Compatibility alias for operators and scripts that consumed schema v1. */
  gate: AggregateOnlyGate;
};

export function omitSessionAttention(aggregate: EvalAggregate): AggregateOnlyEvalAggregate {
  const { worstSessions: _worstSessions, ...safeAggregate } = aggregate;
  return safeAggregate;
}

function omitGroupedSessionAttention(
  aggregates: Record<string, EvalAggregate>,
): Record<string, AggregateOnlyEvalAggregate> {
  return Object.fromEntries(
    Object.entries(aggregates).map(([group, aggregate]) => [group, omitSessionAttention(aggregate)]),
  );
}

function aggregateExperimentValidation(validation: VoiceExperimentEvidenceValidation) {
  const invalidConversationCount = validation.failures.length;
  return {
    ok: validation.ok,
    invalidConversationCount,
    failures:
      invalidConversationCount === 0
        ? []
        : [
            `${invalidConversationCount} conversation${invalidConversationCount === 1 ? "" : "s"} varied multiple experiment dimensions`,
          ],
  };
}

function syntheticPipelineGate(pipeline: AggregateOnlySyntheticPipeline): AggregateOnlyGate {
  return pipeline.status === "pass"
    ? { ok: true, failures: [] }
    : {
        ok: false,
        failures:
          pipeline.failures.length > 0
            ? pipeline.failures
            : [
                pipeline.status === "fail"
                  ? "synthetic pipeline failed"
                  : "synthetic pipeline evidence is insufficient",
              ],
      };
}

export function buildAggregateOnlyVoiceEvalReport(input: {
  generatedAt: string;
  requestedLimit?: number;
  queriedRows: number;
  oldestFetchedUpdatedAt?: number | null;
  windowComplete?: boolean | null;
  leadRowsQueried?: number;
  syntheticRowsExcluded: number;
  customerCallRows: number;
  conversations: number;
  cohort?: AggregateOnlyVoiceEvalReport["cohort"];
  aggregate: EvalAggregate;
  profileAggregates: Record<string, EvalAggregate>;
  experimentAggregates: Record<string, EvalAggregate>;
  experimentValidation: VoiceExperimentEvidenceValidation;
  latencyAutopilotGate: LatencyAutopilotGate;
  syntheticPipeline?: AggregateOnlySyntheticPipeline;
  historicalEvidenceDebt?: AggregateOnlyHistoricalEvidenceDebt;
  releaseQualityGate?: AggregateOnlyGate;
  thresholdGate: AggregateOnlyGate;
}): AggregateOnlyVoiceEvalReport {
  const experimentValidation = aggregateExperimentValidation(input.experimentValidation);
  const cohort =
    input.cohort ??
    ({
      enabled: false,
      startAt: null,
      environment: null,
      targetModelCell: null,
      customerCallRows: input.customerCallRows,
      customerConversations: input.conversations,
      targetConversations: input.conversations,
      syntheticCallRows: input.syntheticRowsExcluded,
      syntheticConversations: 0,
      preCohortRowsExcluded: 0,
      otherEnvironmentRowsExcluded: 0,
      crossBoundaryRowsExcluded: 0,
    } satisfies AggregateOnlyVoiceEvalReport["cohort"]);
  const syntheticPipeline =
    input.syntheticPipeline ??
    ({
      aggregate: omitSessionAttention(input.aggregate),
      status: "insufficient_data",
      failures: ["synthetic pipeline evidence is unavailable in an unbounded audit"],
    } satisfies AggregateOnlySyntheticPipeline);
  const historicalEvidenceDebt =
    input.historicalEvidenceDebt ??
    ({
      scope: "bounded-pre-cohort-target-cell",
      complete: false,
      validV1: 0,
      missingV1Envelope: 0,
      invalidV1Envelope: 0,
      unresolvedJoin: 0,
      affectsReleaseGate: false,
    } satisfies AggregateOnlyHistoricalEvidenceDebt);
  const releaseQuality =
    input.releaseQualityGate ??
    ({
      ok: input.aggregate.sessionCount > 0 && input.thresholdGate.ok,
      failures: [
        ...(input.aggregate.sessionCount > 0 ? [] : ["evaluation contains 0 customer conversations"]),
        ...input.thresholdGate.failures,
      ],
    } satisfies AggregateOnlyGate);
  const syntheticGate = syntheticPipelineGate(syntheticPipeline);
  const overall = cohort.enabled
    ? {
        ok: releaseQuality.ok && syntheticGate.ok,
        failures: [...releaseQuality.failures, ...syntheticGate.failures],
      }
    : {
        ok: releaseQuality.ok && experimentValidation.ok,
        failures: [...experimentValidation.failures, ...releaseQuality.failures],
      };

  return {
    schemaVersion: 2,
    mode: "aggregate-only",
    generatedAt: input.generatedAt,
    source: {
      requestedLimit: input.requestedLimit ?? input.queriedRows,
      serverCap: 200,
      queryOrder: "updatedAt_desc",
      queriedRows: input.queriedRows,
      oldestFetchedUpdatedAt: input.oldestFetchedUpdatedAt ?? null,
      windowComplete: input.windowComplete ?? null,
      leadRowsQueried: input.leadRowsQueried ?? 0,
      leadCap: 500,
      leadWindowMayBeTruncated: (input.leadRowsQueried ?? 0) >= 500,
      syntheticRowsExcluded: input.syntheticRowsExcluded,
      customerCallRows: input.customerCallRows,
      conversations: input.conversations,
    },
    cohort,
    aggregate: omitSessionAttention(input.aggregate),
    profileAggregates: omitGroupedSessionAttention(input.profileAggregates),
    experimentAggregates: omitGroupedSessionAttention(input.experimentAggregates),
    experimentValidation,
    latencyAutopilotGate: input.latencyAutopilotGate,
    syntheticPipeline,
    historicalEvidenceDebt,
    promotionEvidence: { experimentValidation, latencyAutopilotGate: input.latencyAutopilotGate },
    gates: { releaseQuality, syntheticPipeline: syntheticGate, overall },
    gate: overall,
  };
}
