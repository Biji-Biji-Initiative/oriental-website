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
import { type AggregateOnlyVoiceEvalReport, buildAggregateOnlyVoiceEvalReport } from "@/scripts/lib/voice-eval-audit";

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

const COHORT_START_ISO = "2026-07-17T12:00:00.000Z";
const COHORT_START = Date.parse(COHORT_START_ISO);

function cleanCohortSession(overrides: Record<string, unknown> = {}) {
  return voiceSession({
    createdAt: COHORT_START + 1_000,
    updatedAt: COHORT_START + 2_000,
    deploymentEnvironment: "staging",
    modelCell: "candidate",
    closeReason: "manual",
    voice: "coral",
    speed: 1.28,
    variant: null,
    transport: {
      disconnectCount: 0,
      recoveryCount: 0,
      iceRestartCount: 0,
      wasSpeakingAtClose: false,
    },
    ...overrides,
  });
}

async function runCohortAudit(input: {
  sessions: Array<Record<string, unknown>>;
  leads?: Array<Record<string, unknown>>;
  limit?: number;
  extraArgs?: string[];
}) {
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
      const args = Array.isArray(parsedBody.args) ? (parsedBody.args[0] as Record<string, unknown>) : {};
      const value =
        parsedBody.path === "leads:adminLeadTable"
          ? (input.leads ?? [])
          : parsedBody.path === "leads:voiceSessionByReviewId"
            ? (input.sessions.find((session) => session.reviewId === args.reviewId) ?? null)
            : input.sessions;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "success", value }));
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock Convex server did not bind a port");
  const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-release-cohort-"));
  temporaryDirectories.push(cwd);
  const repositoryRoot = resolve(import.meta.dirname, "..");
  let stdout = "";
  let stderr = "";
  let code = 0;
  try {
    try {
      const result = await execFileAsync(
        resolve(repositoryRoot, "node_modules/.bin/tsx"),
        [
          resolve(repositoryRoot, "scripts/eval-voice.ts"),
          "--aggregate-only",
          "--limit",
          String(input.limit ?? 20),
          "--cohort-start",
          COHORT_START_ISO,
          "--cohort-environment",
          "staging",
          "--target-model-cell",
          "candidate",
          ...(input.extraArgs ?? []),
        ],
        {
          cwd,
          env: {
            ...process.env,
            CONVEX_URL: `http://127.0.0.1:${address.port}`,
            CONVEX_INGEST_SECRET: "test-ingest-secret",
            IP_HASH_SECRET: "test-submission-evidence-secret",
          },
        },
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      code = failure.code ?? 1;
      stdout = failure.stdout ?? "";
      stderr = failure.stderr ?? "";
    }
    return { code, stdout, stderr, requests, files: await readdir(cwd) };
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
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
        schemaVersion: 2,
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
          [
            resolve(repositoryRoot, "scripts/eval-voice.ts"),
            "--aggregate-only",
            "--limit",
            "10",
            "--max-capture-failures",
            "0",
          ],
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
          [
            resolve(repositoryRoot, "scripts/eval-voice.ts"),
            "--aggregate-only",
            "--limit",
            "10",
            "--max-capture-failures",
            "0",
          ],
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
        args: [{ ingestSecret: "test-ingest-secret", limit: 500 }],
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
          [
            resolve(repositoryRoot, "scripts/eval-voice.ts"),
            "--aggregate-only",
            "--limit",
            "10",
            "--max-capture-failures",
            "0",
          ],
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
      let stdout = "";
      let code = 0;
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
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        code = failure.code ?? 1;
        stderr = String(failure.stderr ?? "");
        stdout = String(failure.stdout ?? "");
      }

      if (failureMode !== "query-error") {
        expect(code).toBe(2);
        expect(JSON.parse(stdout)).toMatchObject({
          aggregate: { captureIntegrity: { unattributedEmailSubmissions: 1 } },
          gate: { ok: false, failures: ["captureIntegrityFailures 1 > 0"] },
        });
      } else {
        expect(stderr).toContain(
          "Submitted email attribution query failed; capture-integrity evidence is unavailable.",
        );
      }
      expect(stderr).not.toMatch(
        /private-lead-id|private dot address at example dot com|private upstream attribution error/i,
      );
      expect(stdout).not.toMatch(/private-lead-id|private dot address at example dot com/i);
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
      failures: [
        "1 conversation varied multiple experiment dimensions",
        "evaluation contains 0 customer conversations",
      ],
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

  it("gates only the current staging target while surfacing bounded historical evidence debt", async () => {
    const oldMissing = cleanCohortSession({
      reviewId: "private-old-missing-review",
      sessionId: "private-old-missing-session",
      conversationId: "private-old-missing-conversation",
      createdAt: COHORT_START - 4_000,
      updatedAt: COHORT_START - 3_000,
      leadId: "private-old-missing-lead",
      submittedAt: COHORT_START - 3_500,
      transcript: [{ role: "user", text: "old.missing.private@example.com" }],
    });
    const oldInvalid = cleanCohortSession({
      reviewId: "private-old-invalid-review",
      sessionId: "private-old-invalid-session",
      conversationId: "private-old-invalid-conversation",
      createdAt: COHORT_START - 3_000,
      updatedAt: COHORT_START - 2_000,
      leadId: "private-old-invalid-lead",
      submittedAt: COHORT_START - 2_500,
      transcript: [{ role: "user", text: "old.invalid.private@example.com" }],
    });
    const customer = cleanCohortSession({
      reviewId: "private-current-review",
      sessionId: "private-current-session",
      conversationId: "private-current-conversation",
      variant: "kl-polished",
      transcript: [{ role: "user", text: "private current transcript sentinel" }],
    });
    const synthetic = cleanCohortSession({
      reviewId: "private-synthetic-review",
      sessionId: "private-synthetic-session",
      conversationId: "private-synthetic-conversation",
      createdAt: COHORT_START + 2_000,
      updatedAt: COHORT_START + 3_000,
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const production = cleanCohortSession({
      reviewId: "private-production-review",
      sessionId: "private-production-session",
      conversationId: "private-production-conversation",
      deploymentEnvironment: "production",
      createdAt: COHORT_START + 3_000,
      updatedAt: COHORT_START + 4_000,
    });
    const crossBoundaryOld = cleanCohortSession({
      reviewId: "private-cross-old-review",
      sessionId: "private-cross-old-session",
      conversationId: "private-cross-conversation",
      createdAt: COHORT_START - 1_000,
      updatedAt: COHORT_START - 500,
    });
    const crossBoundaryCurrent = cleanCohortSession({
      reviewId: "private-cross-current-review",
      sessionId: "private-cross-current-session",
      conversationId: "private-cross-conversation",
      createdAt: COHORT_START + 4_000,
      updatedAt: COHORT_START + 5_000,
    });

    const result = await runCohortAudit({
      sessions: [crossBoundaryCurrent, production, synthetic, customer, crossBoundaryOld, oldInvalid, oldMissing],
      leads: [
        {
          leadId: "private-old-invalid-lead",
          email: "old.invalid.private@example.com",
          voiceReviewId: "private-old-invalid-review",
          voiceSessionId: "private-old-invalid-session",
          transcript: oldInvalid.transcript,
          createdAt: COHORT_START - 2_500,
          utm: { [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: "malformed-private-envelope" },
        },
        {
          leadId: "private-old-missing-lead",
          email: "old.missing.private@example.com",
          voiceReviewId: "private-old-missing-review",
          voiceSessionId: "private-old-missing-session",
          transcript: oldMissing.transcript,
          createdAt: COHORT_START - 3_500,
          utm: {},
        },
      ],
    });

    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as AggregateOnlyVoiceEvalReport;
    expect(report).toMatchObject({
      schemaVersion: 2,
      source: { requestedLimit: 20, serverCap: 200, queryOrder: "updatedAt_desc", windowComplete: true },
      cohort: {
        enabled: true,
        startAt: COHORT_START_ISO,
        environment: "staging",
        targetModelCell: "candidate",
        customerCallRows: 1,
        customerConversations: 1,
        targetConversations: 1,
        syntheticCallRows: 1,
        syntheticConversations: 1,
        preCohortRowsExcluded: 2,
        otherEnvironmentRowsExcluded: 1,
        crossBoundaryRowsExcluded: 2,
      },
      aggregate: { sessionCount: 1 },
      syntheticPipeline: { status: "pass", aggregate: { sessionCount: 1 } },
      historicalEvidenceDebt: {
        complete: true,
        validV1: 0,
        missingV1Envelope: 1,
        invalidV1Envelope: 1,
        unresolvedJoin: 0,
        affectsReleaseGate: false,
      },
      gates: {
        releaseQuality: { ok: true, failures: [] },
        syntheticPipeline: { ok: true, failures: [] },
        overall: { ok: true, failures: [] },
      },
      gate: { ok: true, failures: [] },
      promotionEvidence: { experimentValidation: { ok: false, invalidConversationCount: 1 } },
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(
      /private-(?:old|current|synthetic|production|cross)|private current transcript sentinel|private@example\.com/i,
    );
    expect(serialized).not.toMatch(/reviewId|sessionId|conversationId|transcript|worstSessions/);
    expect(result.requests.every((request) => String(request.path).startsWith("leads:"))).toBe(true);
    expect(result.requests.some((request) => String(request.path).includes("recordVoiceEvals"))).toBe(false);
    expect(result.files).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["invalid", { [VOICE_SUBMISSION_EVIDENCE_UTM_KEY]: "malformed-current-envelope" }],
  ])("reports and gates a current candidate submission with %s v1 evidence", async (_label, utm) => {
    const submitted = cleanCohortSession({
      leadId: "private-current-lead",
      submittedAt: COHORT_START + 1_500,
      transcript: [{ role: "user", text: "current.private@example.com" }],
    });
    const synthetic = cleanCohortSession({
      reviewId: "private-current-synthetic-review",
      sessionId: "private-current-synthetic-session",
      conversationId: "private-current-synthetic-conversation",
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const result = await runCohortAudit({
      sessions: [synthetic, submitted],
      leads: [
        {
          leadId: "private-current-lead",
          email: "current.private@example.com",
          voiceReviewId: "private-review-id",
          voiceSessionId: "private-session-id",
          transcript: submitted.transcript,
          createdAt: COHORT_START + 1_500,
          utm,
        },
      ],
    });

    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout) as AggregateOnlyVoiceEvalReport;
    expect(report.aggregate.captureIntegrity).toMatchObject({
      staleEmailSubmissions: 0,
      unattributedEmailSubmissions: 1,
      totalFailures: 1,
    });
    expect(report.gates.releaseQuality).toEqual({
      ok: false,
      failures: ["captureIntegrityFailures 1 > 0"],
    });
    expect(result.stderr).not.toMatch(/private-current-lead|current\.private@example\.com/i);
    expect(JSON.stringify(report)).not.toMatch(/private-current-lead|current\.private@example\.com/i);
    expect(result.files).toEqual([]);
  });

  it("never reports a green release gate when the current target customer cohort is empty", async () => {
    const control = cleanCohortSession({ modelCell: "control" });
    const synthetic = cleanCohortSession({
      reviewId: "private-empty-synthetic-review",
      sessionId: "private-empty-synthetic-session",
      conversationId: "private-empty-synthetic-conversation",
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const result = await runCohortAudit({ sessions: [synthetic, control] });

    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout) as AggregateOnlyVoiceEvalReport;
    expect(report.aggregate.sessionCount).toBe(0);
    expect(report.syntheticPipeline.status).toBe("pass");
    expect(report.gates.releaseQuality).toEqual({
      ok: false,
      failures: ["current target cohort contains 0 customer conversations"],
    });
    expect(report.gate.ok).toBe(false);
  });

  it("fails closed on a truncated or boundary-equal updatedAt window and proves an older boundary", async () => {
    const customer = cleanCohortSession({ conversationId: null });
    const synthetic = cleanCohortSession({
      reviewId: "private-window-synthetic-review",
      sessionId: "private-window-synthetic-session",
      conversationId: "private-window-synthetic-conversation",
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const truncated = await runCohortAudit({ sessions: [synthetic, customer], limit: 2 });
    expect(truncated.code).toBe(2);
    expect(JSON.parse(truncated.stdout)).toMatchObject({
      source: { windowComplete: false },
      gates: {
        releaseQuality: {
          ok: false,
          failures: ["query window is incomplete for the requested cohort"],
        },
      },
    });

    const boundaryCustomer = cleanCohortSession({ createdAt: COHORT_START, updatedAt: COHORT_START });
    const equalBoundary = await runCohortAudit({ sessions: [synthetic, boundaryCustomer], limit: 2 });
    expect(equalBoundary.code).toBe(2);
    expect(JSON.parse(equalBoundary.stdout).source).toMatchObject({
      oldestFetchedUpdatedAt: COHORT_START,
      windowComplete: false,
    });

    const oldControl = cleanCohortSession({
      reviewId: "private-old-control-review",
      sessionId: "private-old-control-session",
      conversationId: "private-old-control-conversation",
      modelCell: "control",
      createdAt: COHORT_START - 2_000,
      updatedAt: COHORT_START - 1_000,
    });
    const proved = await runCohortAudit({ sessions: [synthetic, customer, oldControl], limit: 3 });
    expect(proved.code).toBe(0);
    const provedReport = JSON.parse(proved.stdout) as AggregateOnlyVoiceEvalReport;
    expect(provedReport.source).toMatchObject({
      oldestFetchedUpdatedAt: COHORT_START - 1_000,
      windowComplete: true,
    });
    // The current release window is complete because the oldest updated row is
    // pre-cutoff, but older historical sessions may still exist beyond the
    // bounded result. Never overstate debt-scan completeness.
    expect(provedReport.historicalEvidenceDebt.complete).toBe(false);
  });

  it("fails a cap-edge lead window that could conceal a lost voice snapshot", async () => {
    const customer = cleanCohortSession();
    const synthetic = cleanCohortSession({
      reviewId: "private-lead-cap-synthetic-review",
      sessionId: "private-lead-cap-synthetic-session",
      conversationId: "private-lead-cap-synthetic-conversation",
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const capEdgeLeads = Array.from({ length: 500 }, (_, index) => ({
      leadId: `private-cap-edge-lead-${index}`,
      createdAt: COHORT_START + 10_000 - index,
      utm: {},
    }));
    const incomplete = await runCohortAudit({ sessions: [synthetic, customer], leads: capEdgeLeads });

    expect(incomplete.code).toBe(2);
    const incompleteReport = JSON.parse(incomplete.stdout) as AggregateOnlyVoiceEvalReport;
    expect(incompleteReport.source).toMatchObject({
      leadRowsQueried: 500,
      leadCap: 500,
      oldestFetchedLeadCreatedAt: COHORT_START + 9_501,
      leadWindowComplete: false,
      leadWindowMayBeTruncated: true,
    });
    expect(incompleteReport.gates.releaseQuality).toEqual({
      ok: false,
      failures: ["lead query window is incomplete for the requested cohort"],
    });
    expect(incompleteReport.syntheticPipeline.status).toBe("pass");
    expect(incompleteReport.historicalEvidenceDebt.complete).toBe(false);

    const boundedLeads = capEdgeLeads.map((lead, index) =>
      index === capEdgeLeads.length - 1 ? { ...lead, createdAt: COHORT_START - 1 } : lead,
    );
    const bounded = await runCohortAudit({ sessions: [synthetic, customer], leads: boundedLeads });
    expect(bounded.code).toBe(0);
    expect(JSON.parse(bounded.stdout).source).toMatchObject({
      oldestFetchedLeadCreatedAt: COHORT_START - 1,
      leadWindowComplete: true,
      leadWindowMayBeTruncated: true,
    });

    const invalidTimestamp = await runCohortAudit({
      sessions: [synthetic, customer],
      leads: [{ leadId: "private-invalid-created-at-lead", createdAt: "not-a-timestamp", utm: {} }],
    });
    expect(invalidTimestamp.code).toBe(2);
    expect(JSON.parse(invalidTimestamp.stdout).source).toMatchObject({
      oldestFetchedLeadCreatedAt: null,
      leadWindowComplete: false,
    });
  });

  it("fails target reconnect history at the exact row limit and excludes it from promotion evidence", async () => {
    const customer = cleanCohortSession({
      reviewId: "private-history-current-review",
      sessionId: "private-history-current-session",
      conversationId: "private-history-conversation",
    });
    const synthetic = cleanCohortSession({
      reviewId: "private-history-synthetic-review",
      sessionId: "private-history-synthetic-session",
      conversationId: "private-history-synthetic-conversation",
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const oldControl = cleanCohortSession({
      reviewId: "private-history-old-control-review",
      sessionId: "private-history-old-control-session",
      conversationId: null,
      modelCell: "control",
      createdAt: COHORT_START - 2_000,
      updatedAt: COHORT_START - 1_000,
    });
    const currentControl = cleanCohortSession({
      reviewId: "private-history-current-control-review",
      sessionId: "private-history-current-control-session",
      conversationId: "private-history-current-control-conversation",
      modelCell: "control",
    });
    const result = await runCohortAudit({ sessions: [synthetic, customer, currentControl, oldControl], limit: 4 });

    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout) as AggregateOnlyVoiceEvalReport;
    expect(report.source).toMatchObject({ windowComplete: true, leadWindowComplete: true });
    expect(report.cohort).toMatchObject({
      customerConversations: 2,
      targetConversations: 1,
      targetConversationHistoryComplete: false,
      targetConversationsWithIncompleteHistory: 1,
      promotionEvidenceConversations: 0,
    });
    expect(report.gates.releaseQuality).toEqual({
      ok: false,
      failures: ["1 target conversation may have reconnect history outside the query window"],
    });
    expect(report.aggregate.sessionCount).toBe(1);
    expect(report.experimentAggregates).toEqual({});
    expect(report.promotionEvidence.latencyAutopilotGate.status).toBe("insufficient_data");
    expect(report.syntheticPipeline.status).toBe("pass");
    // Root's stricter historical debt rule is intentional: exact-limit session
    // results never prove the older debt scan complete.
    expect(report.historicalEvidenceDebt.complete).toBe(false);
  });

  it("keeps synthetic pipeline failure separate from clean customer quality", async () => {
    const customer = cleanCohortSession();
    const failedSynthetic = cleanCohortSession({
      reviewId: "private-quota-synthetic-review",
      sessionId: "private-quota-synthetic-session",
      conversationId: "private-quota-synthetic-conversation",
      closeReason: "realtime_quota_exhausted",
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const result = await runCohortAudit({ sessions: [failedSynthetic, customer] });

    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout) as AggregateOnlyVoiceEvalReport;
    expect(report.gates.releaseQuality.ok).toBe(true);
    expect(report.syntheticPipeline).toMatchObject({
      status: "fail",
      failures: ["synthetic availability failures 1 > 0"],
    });
    expect(report.gate).toMatchObject({ ok: false });
  });

  it("distinguishes an unused synthetic probe from an activated probe with no remote audio", async () => {
    const customer = cleanCohortSession();
    const unusedSynthetic = cleanCohortSession({
      reviewId: "private-unused-synthetic-review",
      sessionId: "private-unused-synthetic-session",
      conversationId: "private-unused-synthetic-conversation",
      activationAttempted: false,
      latency: null,
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const unused = await runCohortAudit({ sessions: [unusedSynthetic, customer] });
    expect(unused.code).toBe(2);
    expect(JSON.parse(unused.stdout).syntheticPipeline).toMatchObject({
      status: "insufficient_data",
      failures: ["synthetic activation evidence is unavailable"],
    });

    const silentSynthetic = cleanCohortSession({
      reviewId: "private-silent-synthetic-review",
      sessionId: "private-silent-synthetic-session",
      conversationId: "private-silent-synthetic-conversation",
      latency: {
        version: 1,
        activation: { tapToLiveMs: 500 },
        turns: [],
      },
      captured: { name: "QA", email: "qa.nebula@example.test", org: "", message: "" },
    });
    const silent = await runCohortAudit({ sessions: [silentSynthetic, customer] });
    expect(silent.code).toBe(2);
    expect(JSON.parse(silent.stdout).syntheticPipeline).toMatchObject({
      status: "fail",
      failures: ["synthetic remote audio evidence is unavailable"],
    });
  });

  it.each(["0", "201", "1.5", "not-a-number"])("rejects invalid limit %s before querying", async (limit) => {
    const repositoryRoot = resolve(import.meta.dirname, "..");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-invalid-limit-"));
    temporaryDirectories.push(cwd);
    await expect(
      execFileAsync(
        resolve(repositoryRoot, "node_modules/.bin/tsx"),
        [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", "--limit", limit],
        { cwd, env: { ...process.env, CONVEX_URL: "", CONVEX_INGEST_SECRET: "" } },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("--limit must be an integer from 1 to 200"),
    });
    expect(await readdir(cwd)).toEqual([]);
  });

  it("rejects a partial cohort contract before querying", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "..");
    const cwd = await mkdtemp(resolve(tmpdir(), "oriental-voice-audit-partial-cohort-"));
    temporaryDirectories.push(cwd);
    await expect(
      execFileAsync(
        resolve(repositoryRoot, "node_modules/.bin/tsx"),
        [resolve(repositoryRoot, "scripts/eval-voice.ts"), "--aggregate-only", "--cohort-start", COHORT_START_ISO],
        { cwd, env: { ...process.env, CONVEX_URL: "", CONVEX_INGEST_SECRET: "" } },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(
        "--cohort-start, --cohort-environment, and --target-model-cell must be provided together",
      ),
    });
    expect(await readdir(cwd)).toEqual([]);
  });
});
