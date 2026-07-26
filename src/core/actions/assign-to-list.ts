import type { TweetAuthor } from "@/core/selection-store";
import {
  type AssignOutcome,
  type AssignResult,
  type MutationEvidence,
  type RemoveOutcome,
  XApiError,
  type XList,
  type XListApi,
} from "@/packages/x-client/types";

export interface MembershipMutationOptions {
  /** Injected for deterministic tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Base human-pacing delay between attempts. */
  delayMs?: number;
  /** Jitter fraction 0..1 applied to delayMs. */
  jitter?: number;
  /** Injectable randomness for jitter. */
  random?: () => number;
  /** Injectable clock for per-attempt result timestamps. */
  now?: () => number;
  /** Checked before each attempt; true aborts the rest (the Stop pill, story beat 7). */
  shouldStop?: () => boolean;
}

export interface AssignOptions extends MembershipMutationOptions {
  /** 1-based progress, reported before each add attempt ("Adding 2 of 7…"). */
  onProgress?: (current: number, total: number) => void;
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
  return runMembershipMutation(
    authors,
    list,
    api.addMember.bind(api),
    "added",
    api.evidence,
    addOutcomeFromError,
    opts,
    opts.onProgress,
  );
}

export interface RemoveResult {
  author: TweetAuthor;
  outcome: RemoveOutcome;
  evidence: MutationEvidence;
  /** Epoch milliseconds when this backend attempt settled. */
  observedAt: number;
  message?: string;
  /** Carried from a rate-limited failure so a partial undo can say "try again in N min". */
  resetAt?: number;
}

export type { RemoveOutcome } from "@/packages/x-client/types";

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
  opts: MembershipMutationOptions = {},
): Promise<RemoveResult[]> {
  return runMembershipMutation(
    authors,
    list,
    api.removeMember.bind(api),
    "removed",
    api.evidence,
    removeOutcomeFromError,
    opts,
  );
}

interface MembershipMutationResult<Outcome extends string> {
  author: TweetAuthor;
  outcome: Outcome;
  evidence: MutationEvidence;
  observedAt: number;
  message?: string;
  resetAt?: number;
}

type MutationFailureOutcome = Exclude<AssignOutcome, "added" | "already-member">;
type AddFailureOutcome = "already-member" | MutationFailureOutcome;

/** Shared pacing, stop, timestamp, and error policy for List membership mutations. */
async function runMembershipMutation<Success extends "added" | "removed", Failure extends string>(
  authors: TweetAuthor[],
  list: XList,
  mutate: (list: XList, author: TweetAuthor) => Promise<void>,
  success: Success,
  evidence: MutationEvidence,
  failureOutcome: (error: unknown) => Failure,
  opts: MembershipMutationOptions,
  onProgress?: AssignOptions["onProgress"],
): Promise<MembershipMutationResult<Success | Failure>[]> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const delayMs = opts.delayMs ?? 700;
  const results: MembershipMutationResult<Success | Failure>[] = [];

  for (let i = 0; i < authors.length; i++) {
    if (opts.shouldStop?.()) break;
    const author = authors[i] as TweetAuthor;
    if (i > 0) await sleep(pace(delayMs, opts)); // pace between attempts, not before the first
    if (opts.shouldStop?.()) break;
    onProgress?.(i + 1, authors.length);

    try {
      await mutate(list, author);
      results.push({ author, outcome: success, evidence, observedAt: now() });
    } catch (e) {
      const observedAt = now();
      const outcome = failureOutcome(e);
      results.push({
        author,
        outcome,
        evidence,
        observedAt,
        message: e instanceof Error ? e.message : String(e),
        ...(e instanceof XApiError && e.resetAt !== undefined ? { resetAt: e.resetAt } : {}),
      });
      if (outcome === "rate-limited") break; // honor backoff, stop the run
    }
  }
  return results;
}

function addOutcomeFromError(e: unknown): AddFailureOutcome {
  if (e instanceof XApiError) {
    if (e.kind === "already-member") return "already-member";
  }
  return mutationFailureOutcome(e);
}

function removeOutcomeFromError(e: unknown): Exclude<RemoveOutcome, "removed"> {
  if (e instanceof XApiError && (e.kind === "already-member" || e.kind === "already-absent")) {
    return "already-absent";
  }
  return mutationFailureOutcome(e);
}

function mutationFailureOutcome(e: unknown): MutationFailureOutcome {
  if (e instanceof XApiError && e.kind === "rate-limited") return "rate-limited";
  if (e instanceof XApiError && e.kind === "protected") return "protected";
  return "failed";
}

function pace(delayMs: number, opts: MembershipMutationOptions): number {
  const jitter = opts.jitter ?? 0.3;
  const rand = (opts.random ?? Math.random)();
  return Math.round(delayMs * (1 + (rand * 2 - 1) * jitter));
}
