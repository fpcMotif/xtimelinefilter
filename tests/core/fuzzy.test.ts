import { describe, expect, it } from "vitest";

import { fuzzyRank, fuzzyScore } from "@/core/fuzzy";

describe("fuzzyScore", () => {
  it("scores empty and tight subsequence matches", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("abc", "abc")).toBe(0);
    expect(fuzzyScore("abc", "a-b-c")).toBe(2);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("acb", "abc")).toBeNull();
  });
});

describe("fuzzyRank", () => {
  it("filters out items that do not match", () => {
    const items = [{ name: "alpha" }, { name: "beta" }];
    expect(fuzzyRank("zz", items, (item) => item.name)).toEqual([]);
  });

  it("breaks equal scores alphabetically by key", () => {
    const items = [{ name: "atom" }, { name: "alpha" }];
    expect(fuzzyRank("a", items, (item) => item.name).map((item) => item.name)).toEqual([
      "alpha",
      "atom",
    ]);
  });
});
