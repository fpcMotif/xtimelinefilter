import type { TweetAuthor } from "@/core/selection-store";

import type { PageDriver } from "./lib/page-driver";
import { XApiError, type XList, type XListApi } from "./types";

/**
 * Policy-conservative alternate backend (ADR-0001/0005): drives the sanctioned X UI
 * via a PageDriver. Idempotent — checks row state before toggling. Requires no
 * bearer/queryId/ct0 (X's own client supplies them).
 */
export class DomXListApi implements XListApi {
  readonly evidence = "ui-state" as const;

  constructor(private readonly driver: PageDriver) {}

  async addMember(list: XList, author: TweetAuthor): Promise<void> {
    try {
      await this.driver.openListsDialog(author);
      if (await this.driver.isChecked(list)) {
        throw new XApiError("already-member", `@${author.screenName} already in "${list.name}"`);
      }
      await this.toggleAndCommit(list, true);
    } finally {
      await this.driver.close();
    }
  }

  async removeMember(list: XList, author: TweetAuthor): Promise<void> {
    try {
      await this.driver.openListsDialog(author);
      if (!(await this.driver.isChecked(list))) {
        throw new XApiError("already-absent", `@${author.screenName} is not in "${list.name}"`);
      }
      await this.toggleAndCommit(list, false);
    } finally {
      await this.driver.close();
    }
  }

  /** Require the dialog's own checked state to acknowledge the toggle before success. */
  private async toggleAndCommit(list: XList, expected: boolean): Promise<void> {
    await this.driver.toggleList(list);
    if ((await this.driver.isChecked(list)) !== expected) {
      throw new XApiError("unknown", `X did not accept the change to "${list.name}"`);
    }
    await this.driver.commit();
  }
}
