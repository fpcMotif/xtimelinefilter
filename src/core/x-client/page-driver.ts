import type { TweetAuthor } from "@/core/selection-store";

/**
 * Thin DOM-interaction layer the DOM backend drives. The real implementation
 * automates x.com's sanctioned "Add/remove from Lists" UI (selectors in
 * content/selectors.ts); it is faked in tests so DomXListApi orchestration is
 * unit-testable. See ADR-0004 and blueprint §8 (dialog internals verified live).
 */
export interface PageDriver {
  /** Open the "Add/remove from Lists" dialog for an author (tweet caret or profile menu). */
  openListsDialog(author: TweetAuthor): Promise<void>;
  /** Names of the user's Lists as shown in the dialog. */
  listNames(): Promise<string[]>;
  /** Whether the row for listName is currently checked (author already a member). */
  isChecked(listName: string): Promise<boolean>;
  /** Toggle the row for listName. */
  toggleList(listName: string): Promise<void>;
  /** Commit the dialog (Save / Done / confirmationSheetConfirm). */
  commit(): Promise<void>;
  /** Dismiss/close the dialog. */
  close(): Promise<void>;
}
