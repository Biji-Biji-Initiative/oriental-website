import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const supervisorScript = join(process.cwd(), "scripts/run-command-with-deadline.ts");
const grandchildProgram =
  'const fs=require("node:fs");setTimeout(()=>fs.writeFileSync(process.argv[1],"mutated"),2000);setInterval(()=>{},1000)';
const childProgram =
  'const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e",process.argv[3],process.argv[1]],{stdio:"ignore"});child.unref();fs.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000)';
const startupSignalProgram =
  'const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e",process.argv[3],process.argv[1]],{stdio:"ignore"});child.unref();process.kill(process.ppid,process.argv[4]);fs.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000)';
const exitingLeaderProgram =
  'const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e",process.argv[3],process.argv[1]],{stdio:"ignore"});child.unref();fs.writeFileSync(process.argv[2],String(process.pid))';

function waitForPath(path: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (existsSync(path)) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${path}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for the deadline supervisor to exit")),
      timeoutMs,
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release command process deadline", () => {
  it("kills a non-resolving process group before its grandchild's delayed mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oriental-release-deadline-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "external-mutation");
    const ready = join(directory, "grandchild-started");
    const startedAt = Date.now();
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        supervisorScript,
        "--timeout-ms",
        "1000",
        "--",
        process.execPath,
        "-e",
        childProgram,
        marker,
        ready,
        grandchildProgram,
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );

    expect(result.status, result.stderr).toBe(124);
    expect(result.stderr).toContain("Command exceeded the 1000 ms release deadline");
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(existsSync(ready)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "kills the detached descendant group and exits nonzero when its supervisor group is cancelled",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "oriental-release-cancellation-"));
      temporaryDirectories.push(directory);
      const marker = join(directory, "external-mutation");
      const ready = join(directory, "grandchild-started");
      const supervisor = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          supervisorScript,
          "--timeout-ms",
          "5000",
          "--",
          process.execPath,
          "-e",
          childProgram,
          marker,
          ready,
          grandchildProgram,
        ],
        { detached: true, stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      supervisor.stderr?.setEncoding("utf8");
      supervisor.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });

      const supervisorPid = supervisor.pid;
      if (!supervisorPid) throw new Error("Deadline supervisor did not expose a process id");
      let completed = false;
      try {
        await waitForPath(ready, 2_000);
        const exit = waitForExit(supervisor, 3_000);
        process.kill(-supervisorPid, "SIGTERM");
        await expect(exit).resolves.toEqual({ code: 143, signal: null });
        expect(stderr).toContain("Release command cancelled by SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        expect(existsSync(marker)).toBe(false);
        completed = true;
      } finally {
        if (!completed) {
          try {
            process.kill(-supervisorPid, "SIGTERM");
          } catch {
            // The supervisor group already exited.
          }
          if (existsSync(ready)) {
            const childGroupPid = Number(readFileSync(ready, "utf8"));
            if (Number.isInteger(childGroupPid) && childGroupPid > 1) {
              try {
                process.kill(-childGroupPid, "SIGKILL");
              } catch {
                // The detached child group already exited.
              }
            }
          }
        }
      }
    },
  );

  it.each([
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)("arms %s cancellation before spawning the detached command", async (signal, expectedCode) => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(join(tmpdir(), `oriental-release-startup-${signal.toLowerCase()}-`));
    temporaryDirectories.push(directory);
    const marker = join(directory, "external-mutation");
    const ready = join(directory, "leader-started");
    const supervisor = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        supervisorScript,
        "--timeout-ms",
        "5000",
        "--",
        process.execPath,
        "-e",
        startupSignalProgram,
        marker,
        ready,
        grandchildProgram,
        signal,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    supervisor.stderr?.setEncoding("utf8");
    supervisor.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      await expect(waitForExit(supervisor, 3_000)).resolves.toEqual({ code: expectedCode, signal: null });
      expect(stderr).toContain(`Release command cancelled by ${signal}`);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (existsSync(ready)) {
        const childGroupPid = Number(readFileSync(ready, "utf8"));
        if (Number.isInteger(childGroupPid) && childGroupPid > 1) {
          try {
            process.kill(-childGroupPid, "SIGKILL");
          } catch {
            // The detached child group already exited.
          }
        }
      }
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a zero-exiting leader and kills its surviving same-group grandchild",
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "oriental-release-leader-exit-"));
      temporaryDirectories.push(directory);
      const marker = join(directory, "external-mutation");
      const ready = join(directory, "leader-started");
      try {
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            "tsx",
            supervisorScript,
            "--timeout-ms",
            "5000",
            "--",
            process.execPath,
            "-e",
            exitingLeaderProgram,
            marker,
            ready,
            grandchildProgram,
          ],
          { encoding: "utf8", timeout: 5_000 },
        );

        expect(result.status, result.stderr).toBe(1);
        expect(result.stderr).toContain("Release command leader exited while descendants remained");
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        expect(existsSync(marker)).toBe(false);
      } finally {
        if (existsSync(ready)) {
          const childGroupPid = Number(readFileSync(ready, "utf8"));
          if (Number.isInteger(childGroupPid) && childGroupPid > 1) {
            try {
              process.kill(-childGroupPid, "SIGKILL");
            } catch {
              // The detached child group already exited.
            }
          }
        }
      }
    },
  );
});
