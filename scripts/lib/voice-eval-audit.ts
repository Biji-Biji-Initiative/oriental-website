import type { EvalAggregate, LatencyAutopilotGate, VoiceExperimentEvidenceValidation } from "../../lib/eval/voice-eval";

export type AggregateOnlyEvalAggregate = Omit<EvalAggregate, "worstSessions">;

export type AggregateOnlyVoiceEvalReport = {
  schemaVersion: 1;
  mode: "aggregate-only";
  generatedAt: string;
  source: {
    queriedRows: number;
    syntheticRowsExcluded: number;
    customerCallRows: number;
    conversations: number;
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
  gate: { ok: boolean; failures: string[] };
};

function omitSessionAttention(aggregate: EvalAggregate): AggregateOnlyEvalAggregate {
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

export function buildAggregateOnlyVoiceEvalReport(input: {
  generatedAt: string;
  queriedRows: number;
  syntheticRowsExcluded: number;
  customerCallRows: number;
  conversations: number;
  aggregate: EvalAggregate;
  profileAggregates: Record<string, EvalAggregate>;
  experimentAggregates: Record<string, EvalAggregate>;
  experimentValidation: VoiceExperimentEvidenceValidation;
  latencyAutopilotGate: LatencyAutopilotGate;
  thresholdGate: { ok: boolean; failures: string[] };
}): AggregateOnlyVoiceEvalReport {
  const experimentValidation = aggregateExperimentValidation(input.experimentValidation);
  return {
    schemaVersion: 1,
    mode: "aggregate-only",
    generatedAt: input.generatedAt,
    source: {
      queriedRows: input.queriedRows,
      syntheticRowsExcluded: input.syntheticRowsExcluded,
      customerCallRows: input.customerCallRows,
      conversations: input.conversations,
    },
    aggregate: omitSessionAttention(input.aggregate),
    profileAggregates: omitGroupedSessionAttention(input.profileAggregates),
    experimentAggregates: omitGroupedSessionAttention(input.experimentAggregates),
    experimentValidation,
    latencyAutopilotGate: input.latencyAutopilotGate,
    gate: {
      ok: input.thresholdGate.ok && experimentValidation.ok,
      failures: [...experimentValidation.failures, ...input.thresholdGate.failures],
    },
  };
}
