import type { TweetAuthor } from "@/core/selection-store";

import type { PageDriver } from "./page-driver";
import { XApiError, type XList, type XListApi } from "./types";

/**
 * Policy-conservative DEFAULT backend (ADR-0001/0005): drives the sanctioned X UI
 * via a PageDriver. Idempotent — checks row state before toggling. Requires no
 * bearer/queryId/ct0 (X's own client supplies them).
 */
export class DomXListApi implements XListApi {
  constructor(private readonly driver: PageDriver) {}

  async getLists(): Promise<XList[]> {
    // The dialog exposes list names, not ids — use the name as the stable key.
    return (await this.driver.listNames()).map((name) => ({ id: name, name }));
  }

  /** The DOM backend never needs a numeric id; resolution is a GraphQL concern. */
  async resolveUserId(_screenName: string): Promise<string | null> {
    return null;
  }

  async addMember(list: XList, author: TweetAuthor): Promise<void> {
    await this.driver.openListsDialog(author);
    try {
      if (await this.driver.isChecked(list.name)) {
        throw new XApiError("already-member", `@${author.screenName} already in "${list.name}"`);
      }
      await this.driver.toggleList(list.name);
      await this.driver.commit();
    } finally {
      await this.driver.close();
    }
  }

  async removeMember(list: XList, author: TweetAuthor): Promise<void> {
    await this.driver.openListsDialog(author);
    try {
      if (!(await this.driver.isChecked(list.name))) return; // already absent: no-op
      await this.driver.toggleList(list.name);
      await this.driver.commit();
    } finally {
      await this.driver.close();
    }
  }
}
