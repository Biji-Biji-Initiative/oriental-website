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
  const email = session.capturedEmailNormalized?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : "";
}

/**
 * Collapse call rows into one entry per conversation, so a dropped-and-resumed
 * intake is reviewed as a single conversation instead of several. Grouping is
 * primarily by conversationId (stable across reconnects within one tab), with
 * a bounded second pass that stitches groups sharing the same captured email —
 * this recovers the cross-tab / cross-device / new-browser-session resume,
 * where sessionStorage is gone and the client mints a fresh conversationId.
 * Inference requires every call in an explicit unit to carry the same
 * authoritative normalized email. Missing, raw-only, or conflicting identity
 * keeps the unit isolated. Blank IDs fall back to a namespaced review key, and
 * actual call timestamps—not a sparse unit's enclosing interval—decide the
 * nearest compatible group. The latest call heads each entry; every call is
 * kept in deterministic chronological order for per-call inspection.
 */
export function collapseConversations<T extends StitchableSession>(sessions: T[]): Array<T & { calls: T[] }> {
  const groups = new Map<string, T[]>();
  for (const session of sessions) {
    const conversationId = session.conversationId?.trim();
    const key = conversationId ? `conversation:${conversationId}` : `review:${session.reviewId}`;
    const list = groups.get(key);
    if (list) list.push(session);
    else groups.set(key, [session]);
  }

  const units = [...groups.entries()].map(([key, group]) => {
    const calls = [...group].sort(compareSessions);
    return { key, calls, email: consistentUnitEmail(calls) };
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
    const ordered = emailUnits.sort(compareUnits);
    const clusters: Array<{ calls: T[]; key: string }> = [];
    for (const unit of ordered) {
      const compatible = clusters
        .map((cluster) => ({ cluster, gap: nearestActualCallGap(cluster.calls, unit.calls) }))
        .filter(({ gap }) => gap <= CONVERSATION_STITCH_WINDOW_MS)
        .sort((left, right) => left.gap - right.gap || left.cluster.key.localeCompare(right.cluster.key));
      const selected = compatible[0]?.cluster;
      if (selected) {
        selected.calls.push(...unit.calls);
        selected.calls.sort(compareSessions);
        if (unit.key.localeCompare(selected.key) < 0) selected.key = unit.key;
      } else {
        clusters.push({ calls: [...unit.calls], key: unit.key });
      }
    }
    merged.push(...clusters.map(({ calls }) => ({ calls })));
  }

  const heads: Array<T & { calls: T[] }> = [];
  for (const group of merged) {
    const calls = [...group.calls].sort(compareSessions);
    const head = calls[calls.length - 1] as T;
    heads.push({ ...head, calls });
  }
  return heads.sort((a, b) => compareSessions(b, a));
}

function consistentUnitEmail<T extends StitchableSession>(calls: T[]) {
  const email = calls[0] ? sessionEmailKey(calls[0]) : "";
  return email && calls.every((call) => sessionEmailKey(call) === email) ? email : "";
}

function compareSessions(left: StitchableSession, right: StitchableSession) {
  return left.updatedAt - right.updatedAt || left.reviewId.localeCompare(right.reviewId);
}

function compareUnits<T extends StitchableSession>(
  left: { key: string; calls: T[] },
  right: { key: string; calls: T[] },
) {
  const byFirstCall = compareSessions(left.calls[0] as T, right.calls[0] as T);
  return byFirstCall || left.key.localeCompare(right.key);
}

function nearestActualCallGap<T extends StitchableSession>(left: T[], right: T[]) {
  let gap = Number.POSITIVE_INFINITY;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCall = left[leftIndex] as T;
    const rightCall = right[rightIndex] as T;
    gap = Math.min(gap, Math.abs(leftCall.updatedAt - rightCall.updatedAt));
    if (leftCall.updatedAt <= rightCall.updatedAt) leftIndex += 1;
    else rightIndex += 1;
  }
  return gap;
}
