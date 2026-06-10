import type { TweetAuthor } from "@/core/selection-store";
import {
  type AssignOutcome,
  type AssignResult,
  XApiError,
  type XList,
  type XListApi,
} from "@/core/x-client/types";

export interface AssignOptions {
  /** Injected for deterministic tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Base human-pacing delay between adds. */
  delayMs?: number;
  /** Jitter fraction 0..1 applied to delayMs. */
  jitter?: number;
  /** Injectable randomness for jitter. */
  random?: () => number;
}

/**
 * Orchestrates a single user-gesture run: add each author to the list via the
 * active backend, map outcomes. Enforces ADR-0005 policy invariants — human-paced,
 * idempotent already-member, and STOP on rate-limited (no retry-spam). The backend
 * owns id resolution and the add mechanism, so this stays backend-agnostic.
 */
export async function assignAuthorsToList(
  authors: TweetAuthor[],
  list: XList,
  api: XListApi,
  opts: AssignOptions = {},
): Promise<AssignResult[]> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const delayMs = opts.delayMs ?? 700;
  const results: AssignResult[] = [];

  for (let i = 0; i < authors.length; i++) {
    const author = authors[i] as TweetAuthor;
    if (i > 0) await sleep(pace(delayMs, opts)); // pace between adds, not before the first

    try {
      await api.addMember(list, author);
      results.push({ author, outcome: "added" });
    } catch (e) {
      const outcome = outcomeFromError(e);
      results.push({ author, outcome, message: e instanceof Error ? e.message : String(e) });
      if (outcome === "rate-limited") break; // honor backoff, stop the run
    }
  }
  return results;
}

function outcomeFromError(e: unknown): AssignOutcome {
  if (e instanceof XApiError) {
    switch (e.kind) {
      case "already-member":
        return "already-member";
      case "rate-limited":
        return "rate-limited";
      case "protected":
        return "protected";
      default:
        return "failed";
    }
  }
  return "failed";
}

function pace(delayMs: number, opts: AssignOptions): number {
  const jitter = opts.jitter ?? 0.3;
  const rand = (opts.random ?? Math.random)();
  return Math.round(delayMs * (1 + (rand * 2 - 1) * jitter));
}
