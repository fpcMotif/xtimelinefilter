import { describe, expect, it } from "vitest";

import type { XList } from "@/core/x-client/types";
import { createPickerState } from "@/ui/picker-state";

const LISTS: XList[] = [
  { id: "1", name: "Research" },
  { id: "2", name: "Friends" },
  { id: "3", name: "Founders" },
];

describe("createPickerState", () => {
  it("starts with all lists and the first active", () => {
    const p = createPickerState(LISTS);
    expect(p.results.value.map((l) => l.name)).toEqual(["Research", "Friends", "Founders"]);
    expect(p.activeIndex.value).toBe(0);
    expect(p.active.value?.name).toBe("Research");
  });

  it("filters fuzzily and resets the active index on query", () => {
    const p = createPickerState(LISTS);
    p.moveDown();
    p.setQuery("fr");
    // "fr" subsequence-matches both; Friends (contiguous) ranks above Founders (f…r).
    expect(p.results.value.map((l) => l.name)).toEqual(["Friends", "Founders"]);
    expect(p.activeIndex.value).toBe(0);
    expect(p.active.value?.name).toBe("Friends");
  });

  it("moves the active index down and up within bounds", () => {
    const p = createPickerState(LISTS);
    p.moveDown();
    expect(p.active.value?.name).toBe("Friends");
    p.moveDown();
    p.moveDown(); // clamp at last
    expect(p.active.value?.name).toBe("Founders");
    p.moveUp();
    expect(p.active.value?.name).toBe("Friends");
    p.moveUp();
    p.moveUp(); // clamp at first
    expect(p.active.value?.name).toBe("Research");
  });

  it("has a null active when nothing matches", () => {
    const p = createPickerState(LISTS);
    p.setQuery("zzz");
    expect(p.results.value).toEqual([]);
    expect(p.active.value).toBeNull();
  });

  it("reset clears the query and active index", () => {
    const p = createPickerState(LISTS);
    p.setQuery("fo");
    p.reset();
    expect(p.query.value).toBe("");
    expect(p.activeIndex.value).toBe(0);
    expect(p.results.value.length).toBe(3);
  });
});
