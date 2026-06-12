import { SEGMENT_IDS, type SegmentId } from "@/lib/segments";
import type { CapturedLead } from "@/lib/voice/realtime-events";

const STORAGE_KEY = "oriental.last-handoff.v1";
// A founding-partner conversation can resume months later; beyond that the
// remembered details are more likely stale than helpful.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180;

export type RememberedHandoff = {
  name: string;
  email: string;
  org: string;
  segment: SegmentId;
  savedAt: number;
};

/**
 * Local-only memory of the last successful handoff, so a returning visitor is
 * greeted like a known partner instead of re-typing who they are. Never leaves
 * the browser; the per-visit brief is deliberately not stored.
 */
export function rememberHandoff(captured: Pick<CapturedLead, "name" | "email" | "org">, segment: SegmentId) {
  try {
    const value: RememberedHandoff = {
      name: captured.name.trim().slice(0, 120),
      email: captured.email.trim().slice(0, 180),
      org: captured.org.trim().slice(0, 160),
      segment,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode, quota); memory is a nicety.
  }
}

export function recallHandoff(): RememberedHandoff | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedHandoff> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.org !== "string" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    const segment = SEGMENT_IDS.includes(parsed.segment as SegmentId) ? (parsed.segment as SegmentId) : "other";
    return {
      name: parsed.name.slice(0, 120),
      email: parsed.email.slice(0, 180),
      org: parsed.org.slice(0, 160),
      segment,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}
