import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("release command process deadline", () => {
  it("kills a non-resolving process group before its delayed mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "oriental-release-deadline-"));
    temporaryDirectories.push(directory);
    const marker = join(directory, "external-mutation");
    const startedAt = Date.now();
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/run-command-with-deadline.ts",
        "--timeout-ms",
        "100",
        "--",
        process.execPath,
        "-e",
        'const fs=require("node:fs");setTimeout(()=>fs.writeFileSync(process.argv[1],"mutated"),500);setInterval(()=>{},1000)',
        marker,
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
      },
    );

    expect(result.status, result.stderr).toBe(124);
    expect(result.stderr).toContain("Command exceeded the 100 ms release deadline");
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(existsSync(marker)).toBe(false);
  });
});
