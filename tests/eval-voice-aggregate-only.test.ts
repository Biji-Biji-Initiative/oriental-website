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
  it("enriches profile attribution read-only and emits identifier-free JSON without writing files", async () => {
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
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        requests.push({ url: request.url ?? "", body: parsedBody });
        response.writeHead(200, { "content-type": "application/json" });
        const value =
          parsedBody.path === "leads:voiceSessionByReviewId"
            ? { ...sessions[0], voice: "marin", speed: 1.22, variant: "kl-polished" }
            : sessions;
        response.end(JSON.stringify({ status: "success", value }));
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
        aggregate: { sessionCount: 1, droppedMidTurnCount: 1 },
        experimentAggregates: {
          "baseline/control/low/kl-polished/marin/1.22": { sessionCount: 1 },
        },
      });
      expect(serialized).not.toMatch(
        /private-review-id|private-session-id|private-conversation-id|private transcript sentinel/,
      );
      expect(serialized).not.toMatch(/reviewId|sessionId|conversationId|transcript|worstSessions/);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        url: "/api/query",
        body: { path: "leads:voiceSessionsForEval" },
      });
      expect(requests[1]).toMatchObject({
        url: "/api/query",
        body: {
          path: "leads:voiceSessionByReviewId",
          args: [{ ingestSecret: "test-ingest-secret", reviewId: "private-review-id" }],
        },
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("fails closed without exposing identifiers when profile enrichment is incomplete", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        const value = parsedBody.path === "leads:voiceSessionByReviewId" ? null : [voiceSession()];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-incomplete-"));
    temporaryDirectories.push(cwd);
    const repositoryRoot = resolve(import.meta.dirname, "..");

    try {
      await expect(
        execFileAsync(
          resolve(repositoryRoot, "node_modules/.bin/tsx"),
          [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", "--limit", "10"],
          {
            cwd,
            env: {
              ...process.env,
              CONVEX_URL: `http://127.0.0.1:${address.port}`,
              CONVEX_INGEST_SECRET: "test-ingest-secret",
            },
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Voice profile attribution is incomplete; experiment evidence is unavailable."),
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("fails closed without exposing identifiers when the profile query errors", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "application/json" });
        if (parsedBody.path === "leads:voiceSessionByReviewId") {
          response.end(JSON.stringify({ status: "error", errorMessage: "private upstream error" }));
        } else {
          response.end(JSON.stringify({ status: "success", value: [voiceSession()] }));
        }
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-query-error-"));
    temporaryDirectories.push(cwd);
    const repositoryRoot = resolve(import.meta.dirname, "..");

    try {
      let stderr = "";
      try {
        await execFileAsync(
          resolve(repositoryRoot, "node_modules/.bin/tsx"),
          [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", "--limit", "10"],
          {
            cwd,
            env: {
              ...process.env,
              CONVEX_URL: `http://127.0.0.1:${address.port}`,
              CONVEX_INGEST_SECRET: "test-ingest-secret",
            },
          },
        );
        throw new Error("expected aggregate-only evaluation to fail");
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr ?? "");
      }

      expect(stderr).toContain("Voice profile attribution query failed; experiment evidence is unavailable.");
      expect(stderr).not.toMatch(/private-review-id|private-session-id|private-conversation-id|private upstream error/);
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
      failures: ["1 conversation failed experiment evidence validation"],
    });
    expect(report.gate).toEqual({
      ok: false,
      failures: ["1 conversation failed experiment evidence validation"],
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
