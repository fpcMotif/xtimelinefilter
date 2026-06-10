import { describe, expect, it } from "vitest";

import { summarize, summaryLine } from "@/core/result-summary";
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
});

describe("summaryLine", () => {
  it("formats a minimalist line omitting zero categories", () => {
    const line = summaryLine(
      summarize([r("added"), r("added"), r("added"), r("already-member"), r("failed")]),
    );
    expect(line).toBe("Added 3 · 1 already in list · 1 failed");
  });

  it("notes when the run stopped on a rate limit", () => {
    const line = summaryLine(summarize([r("added"), r("rate-limited")]));
    expect(line).toBe("Added 1 · rate limit reached — stopped");
  });

  it("handles an empty run", () => {
    expect(summaryLine(summarize([]))).toBe("Nothing to add");
  });
});
