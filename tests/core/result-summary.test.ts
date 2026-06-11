import { describe, expect, it } from "vitest";

import { summarize } from "@/core/result-summary";
import type { AssignResult } from "@/core/x-client/types";

const r = (outcome: AssignResult["outcome"]): AssignResult => ({
  author: { screenName: "x" },
  outcome,
});

describe("summarize", () => {
  it("counts each outcome", () => {
    const s = summarize([r("added"), r("added"), r("already-member"), r("failed")]);
    expect(s).toEqual({
      added: 2,
      alreadyMember: 1,
      protected: 0,
      rateLimited: 0,
      failed: 1,
      total: 4,
    });
  });

  it("handles an empty run", () => {
    expect(summarize([])).toEqual({
      added: 0,
      alreadyMember: 0,
      protected: 0,
      rateLimited: 0,
      failed: 0,
      total: 0,
    });
  });
});
