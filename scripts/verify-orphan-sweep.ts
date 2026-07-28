import { getAdminOrphanedVoiceSessions } from "@/lib/server/convex";
import { DEFAULT_ORPHAN_STALE_MINUTES } from "@/lib/voice/session-policy";

async function main() {
  const result = await getAdminOrphanedVoiceSessions(DEFAULT_ORPHAN_STALE_MINUTES * 60_000);
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

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
