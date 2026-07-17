import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { aggregateEvals, assessLatencyAutopilotGate } from "@/lib/eval/voice-eval";
import { createVoiceSubmissionEvidence } from "@/lib/server/voice-submission-evidence";
import { VOICE_SUBMISSION_EVIDENCE_UTM_KEY } from "@/lib/voice/submission-evidence";
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
          sequence: 1,
          name: "clear_fields",
          outcome: "success",
          executionMs: 7,
          responseCreatedToCallMs: 13,
          responseCreatedToResultMs: 20,
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
        aggregate: {
          sessionCount: 1,
          droppedMidTurnCount: 1,
          toolLatency: {
            overall: { samples: 1, executionP50Ms: 7, responseCreatedToResultP95Ms: 20 },
            byName: { clear_fields: { samples: 1, executionP50Ms: 7, responseCreatedToResultP50Ms: 20 } },
          },
        },
        experimentAggregates: {
          "baseline/control/low/kl-polished/marin/1.22": { sessionCount: 1 },
        },
      });
      expect(serialized).not.toMatch(
        /private-review-id|private-session-id|private-conversation-id|private transcript sentinel/,
      );
      expect(serialized).not.toMatch(/reviewId|sessionId|conversationId|transcript|worstSessions/);
      expect(requests).toHaveLength(3);
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
      expect(requests[2]).toMatchObject({
        url: "/api/query",
        body: { path: "leads:adminLeadTable" },
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("recovers a staging submission from v1 lead evidence when the final browser snapshot is lost", async () => {
    const evidenceSecret = "aggregate-only-v1-evidence-secret";
    const transcript = [{ role: "user", text: "My email is private@example.com." }];
    const unmarkedSession = voiceSession({
      deploymentEnvironment: "staging",
      voice: "coral",
      speed: 1.28,
      variant: null,
      transcript,
    });
    const acceptedAt = 1_784_280_000_000;
    const envelope = createVoiceSubmissionEvidence(
      {
        acceptedAt,
        authorityTurnSequence: 1,
        email: "private@example.com",
        leadId: "private-recovered-lead-id",
        reviewId: "private-review-id",
        sessionId: "private-session-id",
        source: "speech",
        transcript,
      },
      evidenceSecret,
    );
    const requests: Array<Record<string, unknown>> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        requests.push(parsedBody);
        const value =
          parsedBody.path === "leads:adminLeadTable"
            ? [
                {
                  leadId: "private-recovered-lead-id",
                  email: "private@example.com",
                  voiceReviewId: "private-review-id",
                  voiceSessionId: "private-session-id",
                  transcript,
                  createdAt: acceptedAt,
                  utm: { [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: envelope },
                },
              ]
            : [unmarkedSession];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-recovered-submission-"));
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
            IP_HASH_SECRET: evidenceSecret,
          },
        },
      );

      const report = JSON.parse(result.stdout) as {
        aggregate: {
          submitRate: number;
          captureIntegrity: { staleEmailSubmissions: number; unattributedEmailSubmissions: number };
        };
      };
      expect(report.aggregate).toMatchObject({
        submitRate: 1,
        captureIntegrity: { staleEmailSubmissions: 0, unattributedEmailSubmissions: 0 },
      });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ path: "leads:voiceSessionsForEval" });
      expect(requests[1]).toMatchObject({ path: "leads:adminLeadTable" });
      expect(JSON.stringify(report)).not.toMatch(/private-recovered-lead-id|private@example\.com|private-review-id/);
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("fails closed on a v1 lead when the entire voice-session row is missing", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        requests.push(parsedBody);
        const value =
          parsedBody.path === "leads:adminLeadTable"
            ? [
                {
                  leadId: "private-orphan-lead-id",
                  voiceReviewId: "private-orphan-review-id",
                  voiceSessionId: "private-orphan-session-id",
                  createdAt: 1_784_280_000_000,
                  utm: { [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: "private-orphan-envelope" },
                },
              ]
            : [];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-orphan-submission-"));
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
        stderr: expect.stringContaining(
          "Submitted email attribution is incomplete; capture-integrity evidence is unavailable.",
        ),
      });
      expect(requests).toHaveLength(3);
      expect(requests[0]).toMatchObject({ path: "leads:voiceSessionsForEval" });
      expect(requests[1]).toMatchObject({ path: "leads:adminLeadTable" });
      expect(requests[2]).toMatchObject({
        path: "leads:voiceSessionByReviewId",
        args: [{ ingestSecret: "test-ingest-secret", reviewId: "private-orphan-review-id" }],
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("does not misclassify a signed lead whose durable session fell outside the bounded eval limit", async () => {
    const selectedSession = voiceSession({
      createdAt: 100,
      updatedAt: 300,
      deploymentEnvironment: "production",
      voice: "coral",
      speed: 1.28,
      variant: null,
    });
    const excludedSession = voiceSession({
      reviewId: "private-excluded-review-id",
      sessionId: "private-excluded-session-id",
      conversationId: "private-excluded-conversation-id",
      createdAt: 200,
      updatedAt: 250,
      deploymentEnvironment: "production",
      voice: "coral",
      speed: 1.28,
      variant: null,
    });
    const requests: Array<Record<string, unknown>> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        requests.push(parsedBody);
        const value =
          parsedBody.path === "leads:voiceSessionsForEval"
            ? [selectedSession]
            : parsedBody.path === "leads:adminLeadTable"
              ? [
                  {
                    leadId: "private-excluded-lead-id",
                    voiceReviewId: "private-excluded-review-id",
                    voiceSessionId: "private-excluded-session-id",
                    createdAt: 200,
                    utm: { [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: "private-excluded-envelope" },
                  },
                ]
              : excludedSession;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-bounded-limit-"));
    temporaryDirectories.push(cwd);
    const repositoryRoot = resolve(import.meta.dirname, "..");

    try {
      const result = await execFileAsync(
        resolve(repositoryRoot, "node_modules/.bin/tsx"),
        [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", "--limit", "1"],
        {
          cwd,
          env: {
            ...process.env,
            CONVEX_URL: `http://127.0.0.1:${address.port}`,
            CONVEX_INGEST_SECRET: "test-ingest-secret",
          },
        },
      );

      expect(JSON.parse(result.stdout)).toMatchObject({
        source: { queriedRows: 1, customerCallRows: 1, conversations: 1 },
      });
      expect(requests).toHaveLength(3);
      expect(requests[2]).toMatchObject({
        path: "leads:voiceSessionByReviewId",
        args: [{ ingestSecret: "test-ingest-secret", reviewId: "private-excluded-review-id" }],
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("joins immutable submitted email evidence and hard-gates its PII-free mismatch by default", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const submittedSession = voiceSession({
      deploymentEnvironment: "production",
      leadId: "private-lead-id",
      submittedAt: 100,
      voice: "coral",
      speed: 1.28,
      variant: null,
      captured: { name: "Private", email: "mutable@example.com", org: "", message: "" },
      transcript: [{ role: "user", text: "Actually use new dot address at example dot com." }],
    });
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        requests.push({ body: parsedBody });
        const value =
          parsedBody.path === "leads:adminLeadTable"
            ? [
                {
                  leadId: "private-lead-id",
                  email: "old@example.com",
                  voiceReviewId: "private-review-id",
                  voiceSessionId: "private-session-id",
                  transcript: submittedSession.transcript,
                  createdAt: 100,
                  utm: {},
                },
              ]
            : [submittedSession];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-attribution-"));
    temporaryDirectories.push(cwd);
    const repositoryRoot = resolve(import.meta.dirname, "..");

    try {
      let stdout = "";
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
        throw new Error("expected capture-integrity gate to fail");
      } catch (error) {
        const failure = error as { code?: number; stdout?: string };
        expect(failure.code).toBe(2);
        stdout = failure.stdout ?? "";
      }

      const report = JSON.parse(stdout) as {
        aggregate: { captureIntegrity: { staleEmailSubmissions: number; unattributedEmailSubmissions: number } };
        gate: { ok: boolean; failures: string[] };
      };
      expect(report.aggregate.captureIntegrity).toMatchObject({
        staleEmailSubmissions: 1,
        unattributedEmailSubmissions: 0,
      });
      expect(report.gate).toEqual({ ok: false, failures: ["captureIntegrityFailures 1 > 0"] });
      expect(JSON.stringify(report)).not.toMatch(
        /private-lead-id|mutable@example\.com|old@example\.com|new dot address at example dot com/i,
      );
      expect(requests).toHaveLength(2);
      expect(requests[1]?.body).toMatchObject({
        path: "leads:adminLeadTable",
        args: [{ ingestSecret: "test-ingest-secret", limit: 1000 }],
      });
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it("hard-gates an anaphorically rejected submitted address without querying or exposing lead PII", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const rejectedSession = voiceSession({
      deploymentEnvironment: "production",
      leadId: "private-rejected-lead-id",
      submittedAt: 100,
      voice: "coral",
      speed: 1.28,
      variant: null,
      captured: { name: "Private", email: "private-rejected@example.com", org: "", message: "" },
      transcript: [{ role: "user", text: "Actually private-rejected@example.com, not that one." }],
    });
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        requests.push(parsedBody);
        const value =
          parsedBody.path === "leads:adminLeadTable"
            ? [
                {
                  leadId: "private-rejected-lead-id",
                  email: "private-rejected@example.com",
                  voiceReviewId: "private-review-id",
                  voiceSessionId: "private-session-id",
                  transcript: rejectedSession.transcript,
                  createdAt: 100,
                  utm: {},
                },
              ]
            : [rejectedSession];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "success", value }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-rejected-address-"));
    temporaryDirectories.push(cwd);
    const repositoryRoot = resolve(import.meta.dirname, "..");

    try {
      let stdout = "";
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
        throw new Error("expected rejected-address evidence gate to fail");
      } catch (error) {
        const failure = error as { code?: number; stdout?: string };
        expect(failure.code).toBe(2);
        stdout = failure.stdout ?? "";
      }

      const report = JSON.parse(stdout) as {
        aggregate: { captureIntegrity: { staleEmailSubmissions: number; unattributedEmailSubmissions: number } };
        gate: { ok: boolean; failures: string[] };
      };
      expect(report.aggregate.captureIntegrity).toMatchObject({
        staleEmailSubmissions: 0,
        unattributedEmailSubmissions: 1,
      });
      expect(report.gate).toEqual({ ok: false, failures: ["captureIntegrityFailures 1 > 0"] });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ path: "leads:voiceSessionsForEval" });
      expect(requests[1]).toMatchObject({ path: "leads:adminLeadTable" });
      expect(JSON.stringify(report)).not.toMatch(
        /private-rejected-lead-id|private-rejected@example\.com|not that one/i,
      );
      expect(await readdir(cwd)).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    }
  });

  it.each([
    "query-error",
    "missing-join",
    "legacy-unknown-environment",
  ] as const)("fails closed generically when submitted-email attribution has a %s", async (failureMode) => {
    const submittedSession = voiceSession({
      leadId: "private-lead-id",
      submittedAt: 100,
      voice: "coral",
      speed: 1.28,
      variant: null,
      transcript: [{ role: "user", text: "Actually use private dot address at example dot com." }],
    });
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const parsedBody = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "application/json" });
        if (parsedBody.path !== "leads:adminLeadTable") {
          response.end(JSON.stringify({ status: "success", value: [submittedSession] }));
        } else if (failureMode === "query-error") {
          response.end(JSON.stringify({ status: "error", errorMessage: "private upstream attribution error" }));
        } else if (failureMode === "missing-join") {
          response.end(JSON.stringify({ status: "success", value: [] }));
        } else {
          response.end(
            JSON.stringify({
              status: "success",
              value: [
                {
                  leadId: "private-lead-id",
                  email: "private@example.com",
                  voiceReviewId: "private-review-id",
                  voiceSessionId: "private-session-id",
                  transcript: submittedSession.transcript,
                  createdAt: 100,
                  utm: {},
                },
              ],
            }),
          );
        }
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    const address = server.address();
    if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
    const cwd = await mkdtemp(resolve(tmpdir(), `oriental-voice-audit-${failureMode}-`));
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
        throw new Error("expected submitted-email attribution to fail");
      } catch (error) {
        stderr = String((error as { stderr?: string }).stderr ?? "");
      }

      expect(stderr).toContain(
        failureMode === "query-error"
          ? "Submitted email attribution query failed; capture-integrity evidence is unavailable."
          : "Submitted email attribution is incomplete; capture-integrity evidence is unavailable.",
      );
      expect(stderr).not.toMatch(
        /private-lead-id|private dot address at example dot com|private upstream attribution error/i,
      );
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
