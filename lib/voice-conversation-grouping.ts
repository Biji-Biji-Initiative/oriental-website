/**
 * Groups voice-session call rows into conversations for the admin review view.
 * Kept as a pure, generic module (no React/Convex types) so the stitching
 * heuristic is unit-testable in isolation.
 */

// A resume within an hour of the same person's last call reads as the same
// intake; a fresh call a day later does not. Bounds the email stitch so
// distinct enquiries by one person are never collapsed together.
export const CONVERSATION_STITCH_WINDOW_MS = 60 * 60 * 1000;

export type StitchableSession = {
  reviewId: string;
  conversationId?: string | null;
  updatedAt: number;
  capturedEmailNormalized?: string | null;
  captured?: { email?: string | null } | null;
};

export function sessionEmailKey(session: StitchableSession): string {
  return (session.capturedEmailNormalized ?? session.captured?.email ?? "").trim().toLowerCase();
}

/**
 * Collapse call rows into one entry per conversation, so a dropped-and-resumed
 * intake is reviewed as a single conversation instead of several. Grouping is
 * primarily by conversationId (stable across reconnects within one tab), with
 * a bounded second pass that stitches groups sharing the same captured email —
 * this recovers the cross-tab / cross-device / new-browser-session resume,
 * where sessionStorage is gone and the client mints a fresh conversationId.
 * Anonymous groups (no captured email yet) never stitch: there is nothing to
 * prove they are the same person. Legacy rows without a conversationId stand
 * alone (keyed by reviewId). The latest call heads the entry; every call is
 * kept in chronological order for per-call inspection.
 */
export function collapseConversations<T extends StitchableSession>(sessions: T[]): Array<T & { calls: T[] }> {
  const groups = new Map<string, T[]>();
  for (const session of sessions) {
    const key = session.conversationId ?? session.reviewId;
    const list = groups.get(key);
    if (list) list.push(session);
    else groups.set(key, [session]);
  }

  const units = [...groups.values()].map((group) => {
    const calls = [...group].sort((a, b) => a.updatedAt - b.updatedAt);
    const email = calls.reduce((found, call) => found || sessionEmailKey(call), "");
    return { calls, email, start: calls[0]?.updatedAt ?? 0, end: calls[calls.length - 1]?.updatedAt ?? 0 };
  });

  const merged: Array<{ calls: T[] }> = [];
  const byEmail = new Map<string, Array<(typeof units)[number]>>();
  for (const unit of units) {
    if (!unit.email) {
      merged.push({ calls: unit.calls });
      continue;
    }
    const list = byEmail.get(unit.email);
    if (list) list.push(unit);
    else byEmail.set(unit.email, [unit]);
  }
  for (const emailUnits of byEmail.values()) {
    const ordered = emailUnits.sort((a, b) => a.start - b.start);
    let cluster: { calls: T[]; end: number } | null = null;
    for (const unit of ordered) {
      if (cluster && unit.start - cluster.end <= CONVERSATION_STITCH_WINDOW_MS) {
        cluster.calls.push(...unit.calls);
        cluster.end = Math.max(cluster.end, unit.end);
      } else {
        if (cluster) merged.push({ calls: cluster.calls });
        cluster = { calls: [...unit.calls], end: unit.end };
      }
    }
    if (cluster) merged.push({ calls: cluster.calls });
  }

  const heads: Array<T & { calls: T[] }> = [];
  for (const group of merged) {
    const calls = [...group.calls].sort((a, b) => a.updatedAt - b.updatedAt);
    const head = calls[calls.length - 1] as T;
    heads.push({ ...head, calls });
  }
  return heads.sort((a, b) => b.updatedAt - a.updatedAt);
}
