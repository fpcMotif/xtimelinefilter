import { describe, expect, it } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { DomXListApi } from "@/packages/x-client/dom-api";
import type { PageDriver } from "@/packages/x-client/dom-page-driver";
import { XApiError, type XList } from "@/packages/x-client/types";

class FakeDriver implements PageDriver {
  checked = new Set<string>();
  appliesToggle = true;
  commitFailure: Error | undefined;
  openFailure: Error | undefined;
  calls: string[] = [];
  opened: TweetAuthor[] = [];
  async openListsDialog(author: TweetAuthor): Promise<void> {
    this.opened.push(author);
    this.calls.push("open");
    if (this.openFailure) throw this.openFailure;
  }
  async isChecked(list: XList): Promise<boolean> {
    this.calls.push(`check:${list.id}:${list.name}`);
    return this.checked.has(list.id);
  }
  async toggleList(list: XList): Promise<void> {
    this.calls.push(`toggle:${list.id}:${list.name}`);
    if (!this.appliesToggle) return;
    if (this.checked.has(list.id)) this.checked.delete(list.id);
    else this.checked.add(list.id);
  }
  async commit(): Promise<"immediate"> {
    this.calls.push("commit");
    if (this.commitFailure) throw this.commitFailure;
    return "immediate";
  }
  async close(): Promise<void> {
    this.calls.push("close");
  }
}

const RESEARCH: XList = { id: "L1", name: "Research" };
const jack: TweetAuthor = { screenName: "jack" };

describe("DomXListApi", () => {
  it("opens the dialog, toggles the row and commits when the author is not a member", async () => {
    const d = new FakeDriver();
    await new DomXListApi(d).addMember(RESEARCH, jack);
    expect(d.opened.map((a) => a.screenName)).toEqual(["jack"]);
    expect(d.calls).toEqual([
      "open",
      "check:L1:Research",
      "toggle:L1:Research",
      "check:L1:Research",
      "commit",
      "close",
    ]);
    expect(d.checked.has("L1")).toBe(true);
  });

  it("throws already-member (idempotent) and never toggles when already checked", async () => {
    const d = new FakeDriver();
    d.checked.add("L1");
    await expect(new DomXListApi(d).addMember(RESEARCH, jack)).rejects.toMatchObject({
      kind: "already-member",
    });
    expect(d.calls).toEqual(["open", "check:L1:Research", "close"]);
  });

  it("removeMember toggles + commits when currently a member", async () => {
    const d = new FakeDriver();
    d.checked.add("L1");
    await new DomXListApi(d).removeMember(RESEARCH, jack);
    expect(d.calls).toEqual([
      "open",
      "check:L1:Research",
      "toggle:L1:Research",
      "check:L1:Research",
      "commit",
      "close",
    ]);
    expect(d.checked.has("L1")).toBe(false);
  });

  it("reports already-absent when the author is not a member", async () => {
    const d = new FakeDriver();
    await expect(new DomXListApi(d).removeMember(RESEARCH, jack)).rejects.toMatchObject({
      kind: "already-absent",
    });
    expect(d.calls).toEqual(["open", "check:L1:Research", "close"]);
  });

  it("closes after a partial open failure", async () => {
    const d = new FakeDriver();
    d.openFailure = new XApiError("unknown", "Lists item missing");

    await expect(new DomXListApi(d).addMember(RESEARCH, jack)).rejects.toThrow(
      "Lists item missing",
    );
    expect(d.calls).toEqual(["open", "close"]);
  });

  it("fails honestly and closes when X does not acknowledge a toggle", async () => {
    const d = new FakeDriver();
    d.appliesToggle = false;

    await expect(new DomXListApi(d).addMember(RESEARCH, jack)).rejects.toMatchObject({
      kind: "unknown",
      message: 'X did not accept the change to "Research"',
    });
    expect(d.calls).toEqual([
      "open",
      "check:L1:Research",
      "toggle:L1:Research",
      "check:L1:Research",
      "close",
    ]);
  });

  it("propagates a failed explicit receipt and still closes the dialog", async () => {
    const d = new FakeDriver();
    d.commitFailure = new XApiError("unknown", "Timed out waiting for X to close the Lists dialog");

    await expect(new DomXListApi(d).addMember(RESEARCH, jack)).rejects.toMatchObject({
      kind: "unknown",
      message: "Timed out waiting for X to close the Lists dialog",
    });
    expect(d.calls).toEqual([
      "open",
      "check:L1:Research",
      "toggle:L1:Research",
      "check:L1:Research",
      "commit",
      "close",
    ]);
  });
});
