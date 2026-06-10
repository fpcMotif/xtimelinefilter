import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { summarize } from "@/core/result-summary";
import type { AssignResult } from "@/core/x-client/types";
import { ActionBar } from "@/ui/ActionBar";
import { Toast } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";

describe("TweetOverlay", () => {
  it("reflects selected state and toggles on click", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(<TweetOverlay selected={false} onToggle={onToggle} />);
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<TweetOverlay selected onToggle={onToggle} />);
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ActionBar", () => {
  it("renders nothing when the selection is empty", () => {
    const { container } = render(<ActionBar count={0} onAssign={() => {}} onClear={() => {}} />);
    expect(container.querySelector("section")).toBeNull();
  });

  it("shows the count and wires assign + clear", () => {
    const onAssign = vi.fn();
    const onClear = vi.fn();
    const { getByText, getByLabelText } = render(
      <ActionBar count={3} onAssign={onAssign} onClear={onClear} />,
    );
    expect(getByText("3 selected")).toBeTruthy();
    fireEvent.click(getByText("Add to list"));
    fireEvent.click(getByLabelText("Clear selection"));
    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("Toast", () => {
  it("renders the summary line", () => {
    const results: AssignResult[] = [
      { author: { screenName: "a" }, outcome: "added" },
      { author: { screenName: "b" }, outcome: "added" },
      { author: { screenName: "c" }, outcome: "already-member" },
    ];
    const { container } = render(<Toast summary={summarize(results)} />);
    expect(container.querySelector("output")?.textContent).toBe("Added 2 · 1 already in list");
  });
});
