import { describe, expect, it } from "vitest";

import { feedbackFor } from "@/core/assign-feedback";
import { UNDO_WINDOW_MS } from "@/core/undo";
import type { AssignResult } from "@/packages/x-client/types";

const LIST = { id: "L1", name: "Design Folks" };
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);

const r = (
  screenName: string,
  outcome: AssignResult["outcome"],
  extra: Partial<AssignResult> = {},
): AssignResult => ({
  author: { screenName },
  outcome,
  ...extra,
  observedAt: extra.observedAt ?? NOW,
});

describe("feedbackFor — every failure is a designed beat (story beat 8)", () => {
  it("full success: blue toast with View List and Undo", () => {
    const f = feedbackFor([r("a", "added"), r("b", "added")], LIST, {
      selectedCount: 2,
      nowMs: NOW,
    });
    expect(f.toast).toMatchObject({
      kind: "success",
      title: "Added 2 to Design Folks",
      durationMs: UNDO_WINDOW_MS,
    });
    expect(f.toast.line).toBeUndefined();
    expect(f.actions).toEqual(["view-list", "undo"]);
    expect(f.undoable.map((a) => a.screenName)).toEqual(["a", "b"]);
    expect(f.deselect).toEqual(["a", "b"]);
  });

  it("idempotent members add a literal second line and are deselected, never retried", () => {
    const f = feedbackFor([r("a", "added"), r("b", "already-member")], LIST, {
      selectedCount: 2,
      nowMs: NOW,
    });
    expect(f.toast.title).toBe("Added 1 to Design Folks");
    expect(f.toast.line).toBe("1 was already in the List");
    expect(f.undoable.map((a) => a.screenName)).toEqual(["a"]); // never un-adds pre-existing members
    expect(f.deselect).toEqual(["a", "b"]);
  });

  it("partial failure names the protected author and keeps them selected", () => {
    const f = feedbackFor([r("a", "added"), r("b", "added"), r("prot", "protected")], LIST, {
      selectedCount: 3,
      nowMs: NOW,
    });
    expect(f.toast).toMatchObject({
      kind: "danger",
      title: "Added 2 to Design Folks · 1 failed",
      line: "@prot is protected and can't be added",
    });
    expect(f.actions).toContain("retry");
    expect(f.deselect).toEqual(["a", "b"]); // @prot stays selected
  });

  it("rate limit mid-run: danger toast with NO auto-dismiss, reset minutes, remaining selected", () => {
    const f = feedbackFor(
      [
        r("a", "added"),
        r("b", "added"),
        r("c", "added"),
        r("d", "added"),
        r("e", "rate-limited", { resetAt: Math.floor(NOW / 1000) + 12 * 60 }),
      ],
      LIST,
      { selectedCount: 10, nowMs: NOW }, // e failed; f–j never attempted
    );
    expect(f.toast).toMatchObject({
      kind: "danger",
      title: "X rate limit reached",
      line: "Added 4 · 6 still selected — try again in 12 min",
      durationMs: null,
    });
    expect(f.deselect).toEqual(["a", "b", "c", "d"]);
  });

  it("rate limit without a reset header falls back to 'a few minutes'", () => {
    const f = feedbackFor([r("a", "rate-limited")], LIST, { selectedCount: 1, nowMs: NOW });
    expect(f.toast.line).toBe("Added 0 · 1 still selected — try again in a few minutes");
  });

  it("total failure: persistent danger toast with a literal reason and Retry", () => {
    const f = feedbackFor([r("a", "failed", { message: "HTTP 500" })], LIST, {
      selectedCount: 1,
      nowMs: NOW,
    });
    expect(f.toast).toMatchObject({
      kind: "danger",
      title: "Nothing was added",
      line: "HTTP 500",
      durationMs: null,
    });
    expect(f.actions).toEqual(["retry"]);
    expect(f.deselect).toEqual([]);
  });

  it("user-initiated Stop reports the split and keeps the rest selected", () => {
    const f = feedbackFor([r("a", "added"), r("b", "added")], LIST, {
      selectedCount: 7,
      stopped: true,
      nowMs: NOW,
    });
    expect(f.toast).toMatchObject({ kind: "info", title: "2 added · 5 still selected" });
    expect(f.deselect).toEqual(["a", "b"]);
  });

  it("all-already-member: success toast with View List only (nothing newly added to undo)", () => {
    const f = feedbackFor([r("a", "already-member"), r("b", "already-member")], LIST, {
      selectedCount: 2,
      nowMs: NOW,
    });
    expect(f.toast).toMatchObject({ kind: "success", title: "Added 0 to Design Folks" });
    expect(f.toast.durationMs).toBeUndefined();
    expect(f.toast.line).toBe("2 were already in the List");
    expect(f.actions).toEqual(["view-list"]); // no "undo" — undoable is empty
    expect(f.undoable).toEqual([]);
    expect(f.deselect).toEqual(["a", "b"]);
  });

  it("rate limit defaults nowMs to Date.now when the caller omits it", () => {
    const f = feedbackFor(
      [r("a", "rate-limited", { resetAt: Math.floor(Date.now() / 1000) + 5 * 60 })],
      LIST,
      { selectedCount: 1 }, // no nowMs → falls back to Date.now()
    );
    expect(f.toast.kind).toBe("danger");
    expect(f.toast.line).toContain("still selected — try again in");
  });

  it("total failure falls back to the first failed message when no protected author", () => {
    const f = feedbackFor([r("a", "failed"), r("b", "failed", { message: "HTTP 503" })], LIST, {
      selectedCount: 2,
      nowMs: NOW,
    });
    // failureReason: no protected → first result.message is undefined → second is used? No:
    // it returns the first failed result's message, which is undefined here.
    expect(f.toast.title).toBe("Nothing was added");
    expect(f.toast.line).toBeUndefined();
  });
});
