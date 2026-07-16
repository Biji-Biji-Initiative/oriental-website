export type GitHubLabel = { name: string };

export type GitHubIssue = {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  labels: Array<GitHubLabel | string>;
  assignees: Array<{ login: string }>;
  pull_request?: unknown;
};

export function parseGitHubRepository(remote: string): string | null {
  const normalized = remote.trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
  return match?.[1] ?? null;
}

export function requestHeadersForUrl(url: string, token?: string): Record<string, string> {
  const isGitHubApi = new URL(url).hostname === "api.github.com";
  return {
    Accept: isGitHubApi ? "application/vnd.github+json" : "application/json",
    "User-Agent": "oriental-ops-status",
    ...(token && isGitHubApi ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function extractAprVerdict(markdown: string): string | null {
  const matches = [...markdown.matchAll(/^\s*VERDICT:\s*(.+?)\s*$/gim)];
  return matches.at(-1)?.[1]?.trim() ?? null;
}

export function issueLabelNames(issue: Pick<GitHubIssue, "labels">): string[] {
  return issue.labels.map((label) => (typeof label === "string" ? label : label.name));
}

export function isManualGate(issue: Pick<GitHubIssue, "labels">): boolean {
  const labels = new Set(issueLabelNames(issue).map((label) => label.toLowerCase()));
  return labels.has("manual-gate") || labels.has("human-review");
}

export type VoiceEvidenceSummary = {
  source: string;
  generatedAt: string | null;
  status: "insufficient_data" | "pass" | "fail" | "unknown";
  sessions: number | null;
  candidateSessions: number | null;
  tapToLiveSamples: number | null;
  tapToAudibleSamples: number | null;
  usefulStartRate: number | null;
  realtimeBusySessions: number | null;
  webrtcFailedSessions: number | null;
  missingEvidence: string[];
  failures: string[];
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeVoiceEvidence(report: unknown, source: string): VoiceEvidenceSummary {
  if (!report || typeof report !== "object") return missingVoiceEvidence(source);
  const value = report as Record<string, unknown>;
  const aggregate = (value.aggregate ?? {}) as Record<string, unknown>;
  const activation = (aggregate.activation ?? {}) as Record<string, unknown>;
  const availability = (aggregate.availability ?? {}) as Record<string, unknown>;
  const gate = (value.latencyAutopilotGate ?? {}) as Record<string, unknown>;
  const candidate = (gate.candidate ?? {}) as Record<string, unknown>;
  const status = gate.status;

  return {
    source,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null,
    status: status === "pass" || status === "fail" || status === "insufficient_data" ? status : "unknown",
    sessions: numberOrNull(aggregate.sessionCount),
    candidateSessions: numberOrNull(candidate.sessions),
    tapToLiveSamples: numberOrNull(activation.tapToLiveSamples),
    tapToAudibleSamples: numberOrNull(activation.tapToAudibleSamples),
    usefulStartRate: numberOrNull(activation.usefulStartRate),
    realtimeBusySessions: numberOrNull(availability.realtimeBusySessions),
    webrtcFailedSessions: numberOrNull(availability.webrtcFailedSessions),
    missingEvidence: Array.isArray(gate.missingEvidence)
      ? gate.missingEvidence.filter((item): item is string => typeof item === "string")
      : [],
    failures: Array.isArray(gate.failures)
      ? gate.failures.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function missingVoiceEvidence(source: string): VoiceEvidenceSummary {
  return {
    source,
    generatedAt: null,
    status: "insufficient_data",
    sessions: null,
    candidateSessions: null,
    tapToLiveSamples: null,
    tapToAudibleSamples: null,
    usefulStartRate: null,
    realtimeBusySessions: null,
    webrtcFailedSessions: null,
    missingEvidence: ["no local aggregate-only evaluation report; fail closed"],
    failures: [],
  };
}

export function parseAheadBehind(value: string): { behind: number; ahead: number } {
  const [behind, ahead] = value.trim().split(/\s+/).map(Number);
  return {
    behind: Number.isFinite(behind) ? (behind ?? 0) : 0,
    ahead: Number.isFinite(ahead) ? (ahead ?? 0) : 0,
  };
}
