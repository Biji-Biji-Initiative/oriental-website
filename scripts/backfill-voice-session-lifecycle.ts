import { backfillVoiceSessionLifecycle } from "@/lib/server/convex";

const BATCH_SIZE = 25;
const MAX_ROUNDS = 10_000;

async function main() {
  let updated = 0;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const result = await backfillVoiceSessionLifecycle(BATCH_SIZE);
    if (!result.ok) throw new Error(`voice-session lifecycle backfill unavailable: ${result.reason}`);
    updated += result.updated;
    if (!result.hasMore) {
      process.stdout.write(`${JSON.stringify({ ok: true, rounds: round, updated })}\n`);
      return;
    }
    if (result.updated === 0) throw new Error("voice-session lifecycle backfill made no progress");
  }
  throw new Error(`voice-session lifecycle backfill exceeded ${MAX_ROUNDS} rounds`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
