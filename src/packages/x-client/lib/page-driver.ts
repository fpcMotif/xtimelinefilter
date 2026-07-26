import type { TweetAuthor } from "@/core/selection-store";

import type { XList } from "../types";

/** UI-level evidence that a Lists row change left its dialog. */
export type CommitReceipt = "immediate" | "explicit";

/**
 * Thin DOM-interaction layer the DOM backend drives. The real implementation
 * automates x.com's sanctioned "Add/remove from Lists" UI; it is faked in tests so DomXListApi orchestration is
 * unit-testable. See ADR-0004 and blueprint §8 (dialog internals verified live).
 */
export interface PageDriver {
  /** Open the "Add/remove from Lists" dialog for an author (tweet caret or profile menu). */
  openListsDialog(author: TweetAuthor): Promise<void>;
  /** Whether the one row resolved for this List is checked. Missing/ambiguous rows throw. */
  isChecked(list: XList): Promise<boolean>;
  /** Toggle the one row resolved for this List. Callers verify the checked-state change. */
  toggleList(list: XList): Promise<void>;
  /**
   * Return immediate only when the checked row is the sole plausible UI
   * acknowledgement. For an explicit Save or Done control, wait until the opened
   * dialog disconnects before returning explicit.
   */
  commit(): Promise<CommitReceipt>;
  /** Dismiss/close the dialog. */
  close(): Promise<void>;
}
