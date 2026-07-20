import type { TweetAuthor } from "@/core/selection-store";
import {
  type AssignOutcome,
  type AssignResult,
  XApiError,
  type XList,
  type XListApi,
} from "@/packages/x-client/types";

export interface AssignOptions {
  /** Injected for deterministic tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Base human-pacing delay between adds. */
  delayMs?: number;
  /** Jitter fraction 0..1 applied to delayMs. */
  jitter?: number;
  /** Injectable randomness for jitter. */
  random?: () => number;
  /** Injectable clock for per-attempt result timestamps. */
  now?: () => number;
  /** 1-based progress, reported before each attempt ("Adding 2 of 7…"). */
  onProgress?: (current: number, total: number) => void;
  /** Checked before each attempt; true aborts the rest (the Stop pill, story beat 7). */
  shouldStop?: () => boolean;
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
  const now = opts.now ?? Date.now;
  const delayMs = opts.delayMs ?? 700;
  const results: AssignResult[] = [];

  for (let i = 0; i < authors.length; i++) {
    if (opts.shouldStop?.()) break; // user hit Stop: un-attempted authors stay selected
    const author = authors[i] as TweetAuthor;
    if (i > 0) await sleep(pace(delayMs, opts)); // pace between adds, not before the first
    if (opts.shouldStop?.()) break; // Stop or Owner may change while pacing
    opts.onProgress?.(i + 1, authors.length);

    try {
      await api.addMember(list, author);
      results.push({ author, outcome: "added", observedAt: now() });
    } catch (e) {
      const observedAt = now();
      const outcome = outcomeFromError(e);
      results.push({
        author,
        outcome,
        observedAt,
        message: e instanceof Error ? e.message : String(e),
        ...(e instanceof XApiError && e.resetAt !== undefined ? { resetAt: e.resetAt } : {}),
      });
      if (outcome === "rate-limited") break; // honor backoff, stop the run
    }
  }
  return results;
}

export interface RemoveResult {
  author: TweetAuthor;
  outcome: "removed" | AssignOutcome;
  /** Epoch milliseconds when this backend attempt settled. */
  observedAt: number;
  message?: string;
  /** Carried from a rate-limited failure so a partial undo can say "try again in N min". */
  resetAt?: number;
}

/**
 * Undo's counterpart to {@link assignAuthorsToList}: remove each author from the
 * list under the same policy. Removes mutate the same rate-limited API family, so
 * they are human-paced between attempts and STOP on rate-limited. No progress or
 * Stop UI exists on the undo path; shouldStop still fences Owner changes.
 */
export async function removeAuthorsFromList(
  authors: TweetAuthor[],
  list: XList,
  api: XListApi,
  opts: AssignOptions = {},
): Promise<RemoveResult[]> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const delayMs = opts.delayMs ?? 700;
  const results: RemoveResult[] = [];

  for (let i = 0; i < authors.length; i++) {
    if (opts.shouldStop?.()) break;
    const author = authors[i] as TweetAuthor;
    if (i > 0) await sleep(pace(delayMs, opts)); // pace between removes, not before the first
    if (opts.shouldStop?.()) break;

    try {
      await api.removeMember(list, author);
      results.push({ author, outcome: "removed", observedAt: now() });
    } catch (e) {
      const observedAt = now();
      const outcome = outcomeFromError(e);
      results.push({
        author,
        outcome,
        observedAt,
        message: e instanceof Error ? e.message : String(e),
        ...(e instanceof XApiError && e.resetAt !== undefined ? { resetAt: e.resetAt } : {}),
      });
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
