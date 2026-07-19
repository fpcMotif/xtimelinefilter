import { render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

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
});
