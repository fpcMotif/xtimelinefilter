import { describe, expect, it } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { createSelectionStore } from "@/core/selection-store";

const alice: TweetAuthor = { screenName: "alice", displayName: "Alice" };
const bob: TweetAuthor = { screenName: "bob", userId: "42" };

describe("createSelectionStore", () => {
  it("starts empty", () => {
    const s = createSelectionStore();
    expect(s.count.value).toBe(0);
    expect(s.list()).toEqual([]);
    expect(s.selectMode.value).toBe(false);
  });

  it("adds an author and reflects it in count/isSelected/list", () => {
    const s = createSelectionStore();
    s.add(alice);
    expect(s.count.value).toBe(1);
    expect(s.isSelected("alice")).toBe(true);
    expect(s.list()).toEqual([alice]);
  });

  it("dedupes by screenName case-insensitively and merges newly-known userId", () => {
    const s = createSelectionStore();
    s.add({ screenName: "Alice" });
    s.add({ screenName: "alice", userId: "7", displayName: "Alice" });
    expect(s.count.value).toBe(1);
    expect(s.list()[0]).toMatchObject({ screenName: "Alice", userId: "7" });
  });

  it("removes by screenName (case-insensitive)", () => {
    const s = createSelectionStore();
    s.add(alice);
    s.remove("ALICE");
    expect(s.count.value).toBe(0);
    expect(s.isSelected("alice")).toBe(false);
  });

  it("toggles an author on and off", () => {
    const s = createSelectionStore();
    s.toggle(bob);
    expect(s.isSelected("bob")).toBe(true);
    s.toggle(bob);
    expect(s.isSelected("bob")).toBe(false);
  });

  it("clears all selections", () => {
    const s = createSelectionStore();
    s.add(alice);
    s.add(bob);
    s.clear();
    expect(s.count.value).toBe(0);
    expect(s.list()).toEqual([]);
  });

  it("toggles select mode", () => {
    const s = createSelectionStore();
    s.setSelectMode(true);
    expect(s.selectMode.value).toBe(true);
    s.setSelectMode(false);
    expect(s.selectMode.value).toBe(false);
  });

  it("count is a reactive computed signal", () => {
    const s = createSelectionStore();
    const counts: number[] = [];
    const stop = s.count.subscribe((c) => counts.push(c));
    s.add(alice);
    s.add(bob);
    s.remove("alice");
    stop();
    expect(counts).toEqual([0, 1, 2, 1]);
  });
});
