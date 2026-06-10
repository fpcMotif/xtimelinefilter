import { describe, expect, it } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { DomXListApi } from "@/core/x-client/dom-api";
import type { PageDriver } from "@/core/x-client/page-driver";
import type { XList } from "@/core/x-client/types";

class FakeDriver implements PageDriver {
  checked = new Set<string>();
  names = ["Research", "Friends"];
  calls: string[] = [];
  opened: TweetAuthor[] = [];
  async openListsDialog(author: TweetAuthor): Promise<void> {
    this.opened.push(author);
    this.calls.push("open");
  }
  async listNames(): Promise<string[]> {
    return this.names;
  }
  async isChecked(listName: string): Promise<boolean> {
    return this.checked.has(listName);
  }
  async toggleList(listName: string): Promise<void> {
    this.calls.push(`toggle:${listName}`);
    if (this.checked.has(listName)) this.checked.delete(listName);
    else this.checked.add(listName);
  }
  async commit(): Promise<void> {
    this.calls.push("commit");
  }
  async close(): Promise<void> {
    this.calls.push("close");
  }
}

const RESEARCH: XList = { id: "Research", name: "Research" };
const jack: TweetAuthor = { screenName: "jack" };

describe("DomXListApi", () => {
  it("opens the dialog, toggles the row and commits when the author is not a member", async () => {
    const d = new FakeDriver();
    await new DomXListApi(d).addMember(RESEARCH, jack);
    expect(d.opened.map((a) => a.screenName)).toEqual(["jack"]);
    expect(d.calls).toEqual(["open", "toggle:Research", "commit", "close"]);
    expect(d.checked.has("Research")).toBe(true);
  });

  it("throws already-member (idempotent) and never toggles when already checked", async () => {
    const d = new FakeDriver();
    d.checked.add("Research");
    await expect(new DomXListApi(d).addMember(RESEARCH, jack)).rejects.toMatchObject({
      kind: "already-member",
    });
    expect(d.calls).toEqual(["open", "close"]);
  });

  it("removeMember toggles + commits when currently a member", async () => {
    const d = new FakeDriver();
    d.checked.add("Research");
    await new DomXListApi(d).removeMember(RESEARCH, jack);
    expect(d.calls).toEqual(["open", "toggle:Research", "commit", "close"]);
    expect(d.checked.has("Research")).toBe(false);
  });

  it("removeMember is a no-op when the author is not a member", async () => {
    const d = new FakeDriver();
    await new DomXListApi(d).removeMember(RESEARCH, jack);
    expect(d.calls).toEqual(["open", "close"]);
  });

  it("getLists maps dialog list names to XList[]", async () => {
    const lists = await new DomXListApi(new FakeDriver()).getLists();
    expect(lists).toEqual([
      { id: "Research", name: "Research" },
      { id: "Friends", name: "Friends" },
    ]);
  });

  it("resolveUserId returns null (not needed by the DOM backend)", async () => {
    expect(await new DomXListApi(new FakeDriver()).resolveUserId("jack")).toBeNull();
  });
});
