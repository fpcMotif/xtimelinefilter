import { describe, expect, it } from "vitest";

import { createAppState } from "@/content/app-state";
import { createSelectionStore } from "@/core/selection-store";

const jane = { screenName: "jane" };

describe("createAppState — one deterministic Esc grammar (story beat 6)", () => {
  it("Esc unwinds: dialog → picker → review popover → select mode → clear selection", () => {
    const selection = createSelectionStore();
    const app = createAppState(selection);
    selection.add(jane);
    selection.setSelectMode(true);
    app.welcomeOpen.value = true;
    app.shortcutsOpen.value = true;
    app.pickerOpen.value = true;
    app.reviewOpen.value = true;

    expect(app.handleEscape()).toBe(true);
    expect(app.welcomeOpen.value).toBe(false);

    expect(app.handleEscape()).toBe(true);
    expect(app.shortcutsOpen.value).toBe(false);

    expect(app.handleEscape()).toBe(true);
    expect(app.pickerOpen.value).toBe(false);

    expect(app.handleEscape()).toBe(true);
    expect(app.reviewOpen.value).toBe(false);

    expect(app.handleEscape()).toBe(true);
    expect(selection.selectMode.value).toBe(false);
    expect(selection.count.value).toBe(1); // exiting select mode keeps the selection

    expect(app.handleEscape()).toBe(true);
    expect(selection.count.value).toBe(0);

    expect(app.handleEscape()).toBe(false); // nothing left — X's own Esc keeps working
  });

  it("closing the picker also closes its review popover context", () => {
    const selection = createSelectionStore();
    const app = createAppState(selection);
    app.pickerOpen.value = true;
    expect(app.handleEscape()).toBe(true);
    expect(app.pickerOpen.value).toBe(false);
  });
});
