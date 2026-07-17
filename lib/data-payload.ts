export const MAX_TRANSCRIPT_CHARACTERS = 8_000;

export type TranscriptEntry = { role: string; text: string };

/**
 * Keep the newest complete turns inside the aggregate character budget. If a
 * single newest turn exceeds the remaining budget, retain only its beginning;
 * this keeps the stored payload deterministic without byte-oriented logic.
 */
export function boundTranscript<T extends TranscriptEntry>(transcript: readonly T[]): T[] {
  const kept: T[] = [];
  let remaining = MAX_TRANSCRIPT_CHARACTERS;
  for (let index = transcript.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const turn = transcript[index];
    if (!turn) continue;
    if (turn.text.length <= remaining) {
      kept.push(turn);
      remaining -= turn.text.length;
      continue;
    }
    kept.push({ ...turn, text: turn.text.slice(0, remaining) });
    remaining = 0;
  }
  return kept.reverse();
}

export function transcriptCharacterCount(transcript: readonly TranscriptEntry[]) {
  return transcript.reduce((total, turn) => total + turn.text.length, 0);
}

export function normalizeStoredEmail(email: string) {
  return email.trim().toLowerCase();
}
