import type { AssignResult } from "@/core/x-client/types";

export interface AssignSummary {
  added: number;
  alreadyMember: number;
  protected: number;
  rateLimited: number;
  failed: number;
  total: number;
}

export function summarize(results: AssignResult[]): AssignSummary {
  const s: AssignSummary = {
    added: 0,
    alreadyMember: 0,
    protected: 0,
    rateLimited: 0,
    failed: 0,
    total: results.length,
  };
  for (const r of results) {
    if (r.outcome === "added") s.added++;
    else if (r.outcome === "already-member") s.alreadyMember++;
    else if (r.outcome === "protected") s.protected++;
    else if (r.outcome === "rate-limited") s.rateLimited++;
    else s.failed++;
  }
  return s;
}

// Toast copy lives in assign-feedback.ts (canonical strings) — the old
// summaryLine ("N not allowed", "already in list") is gone with it.
