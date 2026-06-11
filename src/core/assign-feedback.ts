import { summarize } from "@/core/result-summary";
import type { TweetAuthor } from "@/core/selection-store";
import {
  addedLine,
  addedPartialLine,
  afterStopLine,
  alreadyInLine,
  minutesUntil,
  NOTHING_ADDED,
  protectedLine,
  RATE_LIMIT_TITLE,
  rateLimitLine,
} from "@/core/strings";
import type { ToastSpec } from "@/core/toast-store";
import type { AssignResult, XList } from "@/core/x-client/types";

export type FeedbackAction = "view-list" | "undo" | "retry";

/**
 * Pure mapping from a run's results to the designed feedback beat (story beat 8):
 * which toast, which single verb, who gets deselected (added + already-member),
 * and who stays selected for Retry (failed / protected / never-attempted).
 */
export interface AssignFeedback {
  toast: Omit<ToastSpec, "actions">;
  actions: FeedbackAction[];
  /** Only outcome === "added" — Undo can never remove a pre-existing membership. */
  undoable: TweetAuthor[];
  /** Screen names to remove from the selection. */
  deselect: string[];
}

export interface FeedbackContext {
  /** Size of the selection when the run started (covers never-attempted people). */
  selectedCount: number;
  /** True when the user pressed Stop mid-run. */
  stopped?: boolean;
  nowMs?: number;
}

export function feedbackFor(
  results: AssignResult[],
  list: XList,
  ctx: FeedbackContext,
): AssignFeedback {
  const s = summarize(results);
  const undoable = results.filter((r) => r.outcome === "added").map((r) => r.author);
  const deselect = results
    .filter((r) => r.outcome === "added" || r.outcome === "already-member")
    .map((r) => r.author.screenName);
  const remaining = Math.max(0, ctx.selectedCount - deselect.length);

  if (ctx.stopped) {
    return {
      toast: { kind: "info", title: afterStopLine(s.added, remaining) },
      actions: [],
      undoable,
      deselect,
    };
  }

  if (s.rateLimited > 0) {
    const reset = results.find((r) => r.outcome === "rate-limited")?.resetAt;
    const minutes = reset !== undefined ? minutesUntil(reset, ctx.nowMs ?? Date.now()) : null;
    return {
      toast: {
        kind: "danger",
        title: RATE_LIMIT_TITLE,
        line: rateLimitLine(s.added, remaining, minutes),
        durationMs: null, // a rate limit is a pause, not a catastrophe — but never auto-dismiss
      },
      actions: [],
      undoable,
      deselect,
    };
  }

  const failedTotal = s.failed + s.protected;
  if (failedTotal > 0 && s.added === 0) {
    return {
      toast: {
        kind: "danger",
        title: NOTHING_ADDED,
        line: failureReason(results),
        durationMs: null,
      },
      actions: ["retry"],
      undoable,
      deselect,
    };
  }
  if (failedTotal > 0) {
    return {
      toast: {
        kind: "danger",
        title: addedPartialLine(s.added, list.name, failedTotal),
        line: failureReason(results),
        durationMs: null,
      },
      actions: ["retry"],
      undoable,
      deselect,
    };
  }

  const toast: AssignFeedback["toast"] = { kind: "success", title: addedLine(s.added, list.name) };
  if (s.alreadyMember > 0) toast.line = alreadyInLine(s.alreadyMember);
  const actions: FeedbackAction[] = ["view-list"];
  if (undoable.length > 0) actions.push("undo");
  return { toast, actions, undoable, deselect };
}

/** Literal reason for the failure line — protected names win, then the first message. */
function failureReason(results: AssignResult[]): string | undefined {
  const prot = results.find((r) => r.outcome === "protected");
  if (prot) return protectedLine(prot.author.screenName);
  return results.find((r) => r.outcome === "failed")?.message;
}
