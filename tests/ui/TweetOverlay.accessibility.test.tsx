import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { TweetOverlay } from "@/ui/TweetOverlay";

describe("TweetOverlay accessible name", () => {
  it("identifies the author in both selection states", () => {
    const screen = render(
      <TweetOverlay screenName="alice" selected={false} visible onToggle={() => {}} />,
    );

    expect(screen.getByRole("button", { name: "Select @alice" })).toBeTruthy();

    screen.rerender(<TweetOverlay screenName="alice" selected visible onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Deselect @alice" })).toBeTruthy();
  });

  it("exposes a Save control that does not depend on keyboard focus", () => {
    const onSave = vi.fn();
    const screen = render(
      <TweetOverlay
        screenName="alice"
        selected={false}
        visible
        onToggle={() => {}}
        onSave={onSave}
      />,
    );

    const save = screen.getByRole("button", { name: "Save post to a Folder" });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledOnce();
  });
});
