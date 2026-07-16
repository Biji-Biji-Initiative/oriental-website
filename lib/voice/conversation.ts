/**
 * One partner intake is a single conversation even when it spans several voice
 * calls — a visitor who drops mid-sentence and reconnects, or switches voice
 * variant, is still continuing the same thread. Every connection mints its own
 * review/session id, so we carry a stable `conversationId` across them to stitch
 * the rows back into one conversation for review and evaluation.
 *
 * Continuity is scoped to the tab (sessionStorage) and to a rolling activity
 * window: reconnecting within the window resumes the conversation; a fresh
 * enquiry after a long gap — or after a successful handoff — starts a new one.
 */

const STORAGE_KEY = "oriental:voice:conversation";
// A reconnect within this window continues the same conversation.
const CONTINUATION_WINDOW_MS = 30 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredConversation = { id: string; at: number };

function readStored(): StoredConversation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConversation>;
    if (isConversationId(parsed?.id) && typeof parsed.at === "number") {
      return { id: parsed.id, at: parsed.at };
    }
  } catch {
    // Corrupt or unavailable storage falls back to a fresh conversation.
  }
  return null;
}

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function write(id: string, at: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ id, at }));
  } catch {
    // sessionStorage can be unavailable (private mode / blocked); the caller
    // still gets a usable id for this page load.
  }
}

/** Resume the current conversation if it is still fresh, otherwise start one. */
export function resolveConversationId(now: number = Date.now()): string {
  const stored = readStored();
  if (stored && now - stored.at < CONTINUATION_WINDOW_MS) {
    write(stored.id, now);
    return stored.id;
  }
  const id = crypto.randomUUID();
  write(id, now);
  return id;
}

/** Keep the current conversation alive while a call is in progress. */
export function touchConversation(now: number = Date.now()) {
  const stored = readStored();
  if (stored) write(stored.id, now);
}

/** End the conversation so the next enquiry starts a fresh thread. */
export function endConversation() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
