import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { DEFAULT_KEYMAP } from "@/content/keyboard";
import { ShortcutsSheet } from "@/ui/ShortcutsSheet";

describe("ShortcutsSheet — renders from the LIVE keymap (story beat 5)", () => {
  it("shows every binding so rebinds self-document", () => {
    const { container, getByText } = render(
      <ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="other" onClose={() => {}} />,
    );
    expect(getByText("Keyboard shortcuts")).toBeTruthy();
    expect(container.querySelectorAll("tr").length).toBe(DEFAULT_KEYMAP.length);
    const caps = [...container.querySelectorAll("kbd")].map((k) => k.textContent);
    expect(caps).toContain("Alt");
    expect(caps).toContain("?");
  });

  it("renders mac glyphs on macOS", () => {
    const { container } = render(
      <ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="mac" onClose={() => {}} />,
    );
    const caps = [...container.querySelectorAll("kbd")].map((k) => k.textContent);
    expect(caps).toContain("⌥");
    expect(caps).not.toContain("Alt");
  });

  it("closes with the trust footer", () => {
    const { getByText } = render(
      <ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="other" onClose={() => {}} />,
    );
    expect(
      getByText(
        "j and k move between posts — those are X's own shortcuts. Lasso never overrides them.",
      ),
    ).toBeTruthy();
  });
});
