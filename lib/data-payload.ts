export const MAX_TRANSCRIPT_CHARACTERS = 8_000;
export const MAX_TRANSCRIPT_BYTES = MAX_TRANSCRIPT_CHARACTERS * 3;

export type TranscriptEntry = { role: string; text: string };

const utf8Encoder = new TextEncoder();

/**
 * Keep the newest complete turns inside aggregate UTF-16 and UTF-8 budgets. If
 * a single newest turn exceeds either remaining budget, retain only its
 * beginning without splitting a Unicode code point.
 */
export function boundTranscript<T extends TranscriptEntry>(transcript: readonly T[]): T[] {
  const kept: T[] = [];
  let remainingCharacters = MAX_TRANSCRIPT_CHARACTERS;
  let remainingBytes = MAX_TRANSCRIPT_BYTES;
  for (let index = transcript.length - 1; index >= 0 && remainingCharacters > 0 && remainingBytes > 0; index -= 1) {
    const turn = transcript[index];
    if (!turn) continue;
    const turnBytes = utf8ByteLength(turn.text);
    if (turn.text.length <= remainingCharacters && turnBytes <= remainingBytes) {
      kept.push(turn);
      remainingCharacters -= turn.text.length;
      remainingBytes -= turnBytes;
      continue;
    }
    const text = truncateUtf8(turn.text, remainingCharacters, remainingBytes);
    if (text.length > 0) kept.push({ ...turn, text });
    remainingCharacters -= text.length;
    remainingBytes -= utf8ByteLength(text);
  }
  return kept.reverse();
}

export function transcriptCharacterCount(transcript: readonly TranscriptEntry[]) {
  return transcript.reduce((total, turn) => total + turn.text.length, 0);
}

export function transcriptByteCount(transcript: readonly TranscriptEntry[]) {
  return transcript.reduce((total, turn) => total + utf8ByteLength(turn.text), 0);
}

export function normalizeStoredEmail(email: string) {
  return email.trim().toLowerCase();
}

function truncateUtf8(text: string, maxCharacters: number, maxBytes: number) {
  const characters: string[] = [];
  let characterCount = 0;
  let byteCount = 0;
  for (const character of text) {
    const nextCharacterCount = characterCount + character.length;
    const nextByteCount = byteCount + utf8ByteLength(character);
    if (nextCharacterCount > maxCharacters || nextByteCount > maxBytes) break;
    characters.push(character);
    characterCount = nextCharacterCount;
    byteCount = nextByteCount;
  }
  return characters.join("");
}

function utf8ByteLength(value: string) {
  return utf8Encoder.encode(value).byteLength;
}
