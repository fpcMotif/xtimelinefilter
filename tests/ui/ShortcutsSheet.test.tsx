import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { DEFAULT_KEYMAP } from "@/content/keyboard";
import { UI_LAYER } from "@/ui/layers";
import { ShortcutsSheet } from "@/ui/ShortcutsSheet";

describe("ShortcutsSheet — renders from the LIVE keymap (story beat 5)", () => {
  it("shows every binding so rebinds self-document", () => {
    const { container, getByText } = render(
      <ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="other" onClose={() => {}} />,
    );
    expect(getByText("Keyboard shortcuts")).toBeTruthy();
    expect(container.querySelectorAll("tr").length).toBe(DEFAULT_KEYMAP.length);
    expect(getByText("Save this post to your default Folder")).toBeTruthy();
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

  it("owns the modal layer", () => {
    const { getByRole } = render(
      <ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="other" onClose={() => {}} />,
    );
    const backdrop = getByRole("dialog").parentElement as HTMLElement;
    expect(Number(backdrop.style.zIndex)).toBe(UI_LAYER.modal);
  });

  it("closes with the trust footer", () => {
    const { getByText } = render(
      <ShortcutsSheet keymap={DEFAULT_KEYMAP} platform="other" onClose={() => {}} />,
    );
    expect(
      getByText(
        "j and k move between posts — those are X's own shortcuts. Lasso never overrides them. Lasso only claims the Alt chords listed above on keydown; bare Alt and Alt+hover stay free for other extensions.",
      ),
    ).toBeTruthy();
  });
});
