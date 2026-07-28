import { backfillVoiceSessionLifecycle } from "@/lib/server/convex";

const BATCH_SIZE = 25;
const MAX_ROUNDS = 10_000;
const RPC_DEADLINE_MS = 30_000;

async function main() {
  let updated = 0;
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const result = await withDeadline(
      backfillVoiceSessionLifecycle(BATCH_SIZE),
      RPC_DEADLINE_MS,
      "voice-session lifecycle backfill RPC exceeded its deadline",
    );
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
