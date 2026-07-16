import { describe, expect, it } from "vitest";
import {
  extractAprVerdict,
  isManualGate,
  parseAheadBehind,
  parseGitHubRepository,
  requestHeadersForUrl,
  summarizeVoiceEvidence,
} from "../scripts/lib/ops-status";

describe("operations status", () => {
  it("derives the GitHub slug from HTTPS and SSH remotes", () => {
    expect(parseGitHubRepository("https://github.com/Biji-Biji-Initiative/oriental-website.git")).toBe(
      "Biji-Biji-Initiative/oriental-website",
    );
    expect(parseGitHubRepository("git@github.com:Biji-Biji-Initiative/oriental-website.git")).toBe(
      "Biji-Biji-Initiative/oriental-website",
    );
    expect(parseGitHubRepository("https://gitlab.example.com/group/repo.git")).toBeNull();
  });

  it("uses the final APR verdict", () => {
    expect(extractAprVerdict("VERDICT: REVISE\n\nnotes\nVERDICT: SHIP GOVERNANCE\n")).toBe("SHIP GOVERNANCE");
    expect(extractAprVerdict("No verdict here")).toBeNull();
  });

  it("never sends GitHub credentials to application health endpoints", () => {
    expect(requestHeadersForUrl("https://api.github.com/repos/org/repo", "secret-token")).toMatchObject({
      Authorization: "Bearer secret-token",
    });
    expect(requestHeadersForUrl("https://oriental.mereka.io/api/health", "secret-token")).not.toHaveProperty(
      "Authorization",
    );
  });

  it("recognizes durable human gates by label", () => {
    expect(isManualGate({ labels: [{ name: "manual-gate" }] })).toBe(true);
    expect(isManualGate({ labels: ["human-review"] })).toBe(true);
    expect(isManualGate({ labels: [{ name: "engineering" }] })).toBe(false);
  });

  it("emits aggregate-only voice evidence", () => {
    const summary = summarizeVoiceEvidence(
      {
        generatedAt: "2026-07-16T00:00:00Z",
        sessions: [{ transcript: "must not leak" }],
        aggregate: {
          sessionCount: 72,
          activation: { tapToLiveSamples: 12, tapToAudibleSamples: 11, usefulStartRate: 0 },
          availability: { realtimeBusySessions: 6, webrtcFailedSessions: 11 },
        },
        latencyAutopilotGate: {
          status: "insufficient_data",
          candidate: { sessions: 0 },
          missingEvidence: ["candidate conversations 0/50"],
          failures: [],
        },
      },
      "eval-reports/latest.json",
    );

    expect(summary).toEqual({
      source: "eval-reports/latest.json",
      generatedAt: "2026-07-16T00:00:00Z",
      status: "insufficient_data",
      sessions: 72,
      candidateSessions: 0,
      tapToLiveSamples: 12,
      tapToAudibleSamples: 11,
      usefulStartRate: 0,
      realtimeBusySessions: 6,
      webrtcFailedSessions: 11,
      missingEvidence: ["candidate conversations 0/50"],
      failures: [],
    });
    expect(JSON.stringify(summary)).not.toContain("transcript");
  });

  it("parses git left-right counts", () => {
    expect(parseAheadBehind("3\t2")).toEqual({ behind: 3, ahead: 2 });
  });
});
