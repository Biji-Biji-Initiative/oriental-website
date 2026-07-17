import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { aggregateEvals, assessLatencyAutopilotGate } from "@/lib/eval/voice-eval";
import { buildAggregateOnlyVoiceEvalReport } from "@/scripts/lib/voice-eval-audit";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

function voiceSession(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: "private-review-id",
    sessionId: "private-session-id",
    conversationId: "private-conversation-id",
    segment: "education",
    status: "closed",
    connectionStatus: "closed",
    closeReason: "disconnected",
    activationAttempted: true,
    transcript: [{ role: "user", text: "private transcript sentinel" }],
    errors: [],
    transport: {
      disconnectCount: 1,
      recoveryCount: 0,
      iceRestartCount: 0,
      wasSpeakingAtClose: true,
    },
    latency: {
      version: 1,
      activation: { tapToLiveMs: 500, tapToAudibleMs: 900 },
      turns: [],
      toolCalls: [
        {
          name: "lookup_oriental",
          outcome: "success",
          executionMs: 18,
          responseCreatedToCallMs: 140,
          responseCreatedToResultMs: 158,
        },
      ],
    },
    routeRequested: false,
    runtimeProfile: "baseline",
    modelCell: "control",
    reasoningCell: "low",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("eval-voice aggregate-only mode", () => {
  it("queries Convex once and emits identifier-free JSON without writing files", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const sessions = [
      voiceSession(),
      voiceSession({
        reviewId: "synthetic-review-id",
        sessionId: "synthetic-session-id",
        conversationId: "synthetic-conversation-id",
        captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
      }),
    ];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push({ url: request.url ?? "", body: JSON.parse(body) as Record<string, unknown> });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value: sessions }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-"));
    temporaryDirectories.push(cwd);
    const repositoryRoot = resolve(import.meta.dirname, "..");

    try {
      const result = await execFileAsync(
        resolve(repositoryRoot, "node_modules/.bin/tsx"),
        [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", "--limit", "10"],
        {
          cwd,
          env: {
            ...process.env,
            CONVEX_URL: `http://127.0.0.1:${address.port}`,
            CONVEX_INGEST_SECRET: "test-ingest-secret",
            OPENAI_API_KEY: "must-not-be-used",
          },
        },
      );

      const report = JSON.parse(result.stdout) as Record<string, unknown>;
      const serialized = JSON.stringify(report);
      expect(report).toMatchObject({
        schemaVersion: 1,
        mode: "aggregate-only",
        source: {
          queriedRows: 2,
          syntheticRowsExcluded: 1,
          customerCallRows: 1,
          conversations: 1,
        },
        aggregate: {
          sessionCount: 1,
          droppedMidTurnCount: 1,
          toolLatency: {
            overall: { samples: 1, executionP50Ms: 18, responseCreatedToResultP95Ms: 158 },
            byName: { lookup_oriental: { samples: 1, executionP95Ms: 18 } },
          },
        },
      });
      expect(serialized).not.toMatch(
        /private-review-id|private-session-id|private-conversation-id|private transcript sentinel/,
      );
      expect(serialized).not.toMatch(/reviewId|sessionId|conversationId|transcript|worstSessions/);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "/api/query",
        body: { path: "leads:voiceSessionsForEval" },
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("removes identifier-bearing experiment validation failures", () => {
    const report = buildAggregateOnlyVoiceEvalReport({
      generatedAt: "2026-07-17T00:00:00.000Z",
      queriedRows: 1,
      syntheticRowsExcluded: 0,
      customerCallRows: 1,
      conversations: 1,
      aggregate: aggregateEvals([]),
      profileAggregates: {},
      experimentAggregates: {},
      experimentValidation: {
        ok: false,
        failures: ["private-review-id varies multiple experiment dimensions: runtime, model"],
      },
      latencyAutopilotGate: assessLatencyAutopilotGate([]),
      thresholdGate: { ok: true, failures: [] },
    });

    expect(report.experimentValidation).toEqual({
      ok: false,
      invalidConversationCount: 1,
      failures: ["1 conversation varied multiple experiment dimensions"],
    });
    expect(report.gate).toEqual({
      ok: false,
      failures: ["1 conversation varied multiple experiment dimensions"],
    });
    expect(JSON.stringify(report)).not.toContain("private-review-id");
  });

  it.each([
    ["--persist", ["--persist"]],
    ["--out", ["--out", "forbidden-report-directory"]],
  ])("rejects the conflicting %s option before querying Convex", async (_label, conflictingArgs) => {
    const repositoryRoot = resolve(import.meta.dirname, "..");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-conflict-"));
    temporaryDirectories.push(cwd);

    await expect(
      execFileAsync(
        resolve(repositoryRoot, "node_modules/.bin/tsx"),
        [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", ...conflictingArgs],
        { cwd, env: { ...process.env, CONVEX_URL: "", CONVEX_INGEST_SECRET: "" } },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("--aggregate-only cannot be combined with --persist or --out"),
    });
    expect(await readdir(cwd)).toEqual([]);
  });
});
