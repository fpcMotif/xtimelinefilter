import type { TweetAuthor } from "@/core/selection-store";

import type { XList } from "../types";

/**
 * Thin DOM-interaction layer the DOM backend drives. The real implementation
 * automates x.com's sanctioned "Add/remove from Lists" UI (selectors in
 * content/selectors.ts); it is faked in tests so DomXListApi orchestration is
 * unit-testable. See ADR-0004 and blueprint §8 (dialog internals verified live).
 */
export interface PageDriver {
  /** Open the "Add/remove from Lists" dialog for an author (tweet caret or profile menu). */
  openListsDialog(author: TweetAuthor): Promise<void>;
  /** Whether the one row resolved for this List is checked. Missing/ambiguous rows throw. */
  isChecked(list: XList): Promise<boolean>;
  /** Toggle the one row resolved for this List. Missing/ambiguous rows throw. */
  toggleList(list: XList): Promise<void>;
  /** Commit the dialog (Save / Done / confirmationSheetConfirm). */
  commit(): Promise<void>;
  /** Dismiss/close the dialog. */
  close(): Promise<void>;
}
