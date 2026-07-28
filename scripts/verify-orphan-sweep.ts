import { getAdminOrphanedVoiceSessions } from "@/lib/server/convex";
import { DEFAULT_ORPHAN_STALE_MINUTES } from "@/lib/voice/session-policy";

const QUERY_DEADLINE_MS = 5_000;

async function main() {
  const result = await withDeadline(
    getAdminOrphanedVoiceSessions(DEFAULT_ORPHAN_STALE_MINUTES * 60_000),
    QUERY_DEADLINE_MS,
    "orphan sweep query exceeded its deadline",
  );
  if (!result.ok) throw new Error(`orphan sweep unavailable: ${result.reason}`);
  if (result.data.migrationPending) throw new Error("orphan sweep unavailable: lifecycle migration is incomplete");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      generatedAt: result.data.generatedAt,
      orphanedVoiceSessions: result.data.orphaned.count,
      countIsLowerBound: result.data.orphaned.truncated,
    })}\n`,
  );
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
