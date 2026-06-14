import { describe, expect, it } from "vitest";

import { isInScope } from "@/content/route";

describe("isInScope", () => {
  it("is in scope on Home and List timelines", () => {
    expect(isInScope("/home")).toBe(true);
    expect(isInScope("/i/lists/123")).toBe(true);
    expect(isInScope("/i/lists/123/members")).toBe(true);
  });

  it("is out of scope everywhere else", () => {
    expect(isInScope("/explore")).toBe(false);
    expect(isInScope("/jack")).toBe(false);
    expect(isInScope("/search")).toBe(false);
    expect(isInScope("/i/lists")).toBe(false);
    expect(isInScope("/notifications")).toBe(false);
  });
});
