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

/** Human, minimalist one-liner for the Toast; omits zero categories. */
export function summaryLine(s: AssignSummary): string {
  const parts: string[] = [];
  if (s.added) parts.push(`Added ${s.added}`);
  if (s.alreadyMember) parts.push(`${s.alreadyMember} already in list`);
  if (s.protected) parts.push(`${s.protected} not allowed`);
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.rateLimited) parts.push("rate limit reached — stopped");
  return parts.join(" · ") || "Nothing to add";
}
