import { describe, expect, it } from "vitest";

import * as S from "@/core/strings";

// The product story's "Canonical strings (implement verbatim)" — each case below
// pins one numbered canonical string so copy drift fails loudly.
describe("canonical strings", () => {
  it("1 — picker header counts people, not posts", () => {
    expect(S.pickerHeader([{ screenName: "jane" }])).toBe("Add @jane to a List");
    expect(S.pickerHeader([{ screenName: "a" }, { screenName: "b" }, { screenName: "c" }])).toBe(
      "Add 3 people to a List",
    );
  });

  it("2 — input placeholder", () => {
    expect(S.SEARCH_PLACEHOLDER).toBe("Search Lists");
  });

  it("3 — success toast and its actions", () => {
    expect(S.addedLine(3, "Design Folks")).toBe("Added 3 to Design Folks");
    expect(S.VIEW_LIST).toBe("View List");
    expect(S.UNDO).toBe("Undo");
  });

  it("4 — idempotent line 2", () => {
    expect(S.alreadyInLine(1)).toBe("1 was already in the List");
    expect(S.alreadyInLine(2)).toBe("2 were already in the List");
  });

  it("5 — protected author", () => {
    expect(S.protectedLine("handle")).toBe("@handle is protected and can't be added");
  });

  it("6 — rate limit title and line", () => {
    expect(S.RATE_LIMIT_TITLE).toBe("X rate limit reached");
    expect(S.rateLimitLine(4, 6, 12)).toBe("Added 4 · 6 still selected — try again in 12 min");
    expect(S.rateLimitLine(4, 6, null)).toBe(
      "Added 4 · 6 still selected — try again in a few minutes",
    );
  });

  it("7 — picker error states", () => {
    expect(S.PICKER_ERROR_TITLE).toBe("Couldn't load your Lists");
    expect(S.PICKER_ERROR_LOGGED_OUT).toBe("You may be logged out of X");
    expect(S.RETRY).toBe("Retry");
    expect(S.PICKER_ERROR_RATE_LIMITED).toBe("X rate limited Lasso — try again in a few minutes");
  });

  it("8 — true empty state", () => {
    expect(S.EMPTY_TITLE).toBe("You don't have any Lists yet");
    expect(S.EMPTY_BODY).toBe("Lists let you group people on X");
    expect(S.EMPTY_CTA).toBe("Create a List on X");
  });

  it("9 — no-match state", () => {
    expect(S.noMatchLine("des")).toBe('No Lists match "des"');
    expect(S.CLEAR_SEARCH).toBe("Clear search");
    expect(S.createOnX("des")).toBe('Create "des" on X');
  });

  it("10 — no-target nudge", () => {
    expect(S.NO_TARGET_NUDGE).toBe("Hover a post first — or press j to focus one");
  });

  it("11 — mute confirmation and failure", () => {
    expect(S.mutedLine("jane")).toBe("Muted @jane");
    expect(S.muteFailedLine("jane")).toBe("Couldn't mute @jane");
  });

  it("12 — select-mode bar", () => {
    expect(S.SELECT_MODE_BAR).toBe("Select mode · click posts or press x · s when done");
  });

  it("13 — post-assign tip", () => {
    expect(S.POST_ASSIGN_TIP).toBe("Tip: Alt+L on a hovered post does this without the mouse");
  });

  it("14 — select-mode nudge", () => {
    expect(S.SELECT_MODE_NUDGE).toBe("Tip: press s to select by clicking posts");
  });

  it("15 — trust line", () => {
    expect(S.TRUST_LINE).toBe("Lasso runs entirely in your browser. Nothing leaves x.com.");
  });

  it("16 — wake toast", () => {
    expect(S.WAKE_TOAST).toBe("Lasso is awake on this tab");
  });

  it("17 — progress and stop", () => {
    expect(S.progressLine(2, 5, "Design Folks")).toBe("Adding 2 of 5 to Design Folks…");
    expect(S.STOP).toBe("Stop");
    expect(S.afterStopLine(2, 3)).toBe("2 added · 3 still selected");
  });

  it("18 — unit tooltip", () => {
    expect(S.UNIT_TOOLTIP).toBe("Lasso adds people to Lists, not posts.");
  });

  it("19 — selector health", () => {
    expect(S.SELECTOR_HEALTH).toBe(
      "Lasso can't read the timeline — X may have changed. Check for an update.",
    );
  });

  it("20 — shortcuts footer", () => {
    expect(S.SHORTCUTS_FOOTER).toBe(
      "j and k move between posts — those are X's own shortcuts. Lasso never overrides them.",
    );
  });
});

describe("derived copy", () => {
  it("counts people with the right plural and tabular grouping", () => {
    expect(S.peopleSelected(1)).toBe("1 person selected");
    expect(S.peopleSelected(7)).toBe("7 people selected");
    expect(S.peopleSelected(1204)).toBe("1,204 people selected");
  });

  it("formats member counts like X does", () => {
    expect(S.memberCountLabel(1204)).toBe("1,204 members");
    expect(S.memberCountLabel(1)).toBe("1 member");
  });

  it("partial-failure title appends the failed count", () => {
    expect(S.addedPartialLine(2, "Design Folks", 1)).toBe("Added 2 to Design Folks · 1 failed");
  });

  it("total failure title", () => {
    expect(S.NOTHING_ADDED).toBe("Nothing was added");
  });

  it("not-interested confirmation", () => {
    expect(S.HIDDEN_LINE).toBe("Hidden — told X you're not interested");
  });

  it("picker footer legend includes the selection count", () => {
    expect(S.pickerFooterLegend(1)).toBe("↑↓ Navigate · Enter Add · Esc Dismiss · 1 selected");
    expect(S.pickerFooterLegend(7)).toBe("↑↓ Navigate · Enter Add · Esc Dismiss · 7 selected");
  });

  it("welcome card copy", () => {
    expect(S.WELCOME_TITLE).toBe("Lasso is ready");
    expect(S.WELCOME_ROWS).toEqual([
      "Hover any post and press Alt+L to file its author into a List",
      "Press s to select many people, then add them all at once",
      "Press ? anytime to see every shortcut",
    ]);
    expect(S.WELCOME_CTA).toBe("Try select mode");
    expect(S.WELCOME_SKIP).toBe("Skip");
  });

  it("first-hover tooltip", () => {
    expect(S.FIRST_HOVER_TIP).toBe("Select — then add everyone to a List at once.");
  });

  it("minutes until a rate-limit reset, never below 1", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(S.minutesUntil(Math.floor(now / 1000) + 12 * 60, now)).toBe(12);
    expect(S.minutesUntil(Math.floor(now / 1000) + 30, now)).toBe(1);
    expect(S.minutesUntil(Math.floor(now / 1000) - 30, now)).toBe(1);
  });
});
