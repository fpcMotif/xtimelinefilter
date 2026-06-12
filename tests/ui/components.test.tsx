import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { createToastStore } from "@/core/toast-store";
import { ActionBar, type ActionBarProps } from "@/ui/ActionBar";
import { ToastHost } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";

const authors = (...names: string[]): TweetAuthor[] => names.map((screenName) => ({ screenName }));

describe("TweetOverlay", () => {
  it("reflects selected state and toggles on click", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <TweetOverlay selected={false} visible onToggle={onToggle} />,
    );
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<TweetOverlay selected visible onToggle={onToggle} />);
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("is hidden by default (pristine timeline) but selected checks stay visible", () => {
    const { container, rerender } = render(
      <TweetOverlay selected={false} visible={false} onToggle={() => {}} />,
    );
    expect(container.querySelector("button")?.className).toContain("opacity-0");
    rerender(<TweetOverlay selected visible={false} onToggle={() => {}} />);
    expect(container.querySelector("button")?.className).not.toContain("opacity-0");
  });

  it("renders the one-time first-hover tooltip when given", () => {
    const { getByRole } = render(
      <TweetOverlay selected={false} visible onToggle={() => {}} tooltip="Select — tip" />,
    );
    expect(getByRole("tooltip").textContent).toBe("Select — tip");
  });
});

function barProps(over: Partial<ActionBarProps> = {}): ActionBarProps {
  return {
    authors: [],
    selectMode: false,
    running: null,
    reviewOpen: false,
    hintKeycaps: null,
    onAssign: vi.fn(),
    onClear: vi.fn(),
    onDone: vi.fn(),
    onStop: vi.fn(),
    onRemove: vi.fn(),
    onToggleReview: vi.fn(),
    ...over,
  };
}

describe("ActionBar", () => {
  it("renders nothing when empty and not in select mode", () => {
    const { container } = render(<ActionBar {...barProps()} />);
    expect(container.querySelector("section")).toBeNull();
  });

  it("counts PEOPLE and wires Add to List + clear", () => {
    const props = barProps({ authors: authors("a", "b", "c") });
    const { getByText, getByLabelText } = render(<ActionBar {...props} />);
    expect(getByText("3 people selected")).toBeTruthy();
    fireEvent.click(getByText("Add to List"));
    fireEvent.click(getByLabelText("Clear selection"));
    expect(props.onAssign).toHaveBeenCalledTimes(1);
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("shows the Alt+L keycap chip during the onboarding window", () => {
    const { container } = render(
      <ActionBar {...barProps({ authors: authors("a"), hintKeycaps: ["Alt", "L"] })} />,
    );
    expect([...container.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Alt", "L"]);
  });

  it("select mode at zero count: crosshair line + Done", () => {
    const props = barProps({ selectMode: true });
    const { getByText } = render(<ActionBar {...props} />);
    expect(getByText("Select mode · click posts or press x · s when done")).toBeTruthy();
    fireEvent.click(getByText("Done"));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it("facepile shows 3 avatars + overflow and opens the review popover", () => {
    const props = barProps({ authors: authors("a", "b", "c", "d", "e", "f", "g") });
    const { getByText, getByLabelText } = render(<ActionBar {...props} />);
    expect(getByText("+4")).toBeTruthy();
    fireEvent.click(getByLabelText("Review selected people"));
    expect(props.onToggleReview).toHaveBeenCalledWith(true);
  });

  it("review popover lists each person with a remove ✕", () => {
    const props = barProps({ authors: authors("jane", "bob"), reviewOpen: true });
    const { getByLabelText } = render(<ActionBar {...props} />);
    fireEvent.click(getByLabelText("Remove @jane"));
    expect(props.onRemove).toHaveBeenCalledWith("jane");
  });

  it("becomes the progress surface with a Stop pill during a run", () => {
    const props = barProps({
      authors: authors("a", "b"),
      running: { current: 2, total: 7, listName: "Design Folks" },
    });
    const { getByText } = render(<ActionBar {...props} />);
    expect(getByText("Adding 2 of 7 to Design Folks…")).toBeTruthy();
    fireEvent.click(getByText("Stop"));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("hovering the count may show the unit tooltip", async () => {
    const onCountHover = vi.fn(async () => "Lasso adds people to Lists, not posts.");
    const { getByText, findByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    fireEvent.mouseEnter(getByText("1 person selected"));
    expect((await findByRole("tooltip")).textContent).toBe(
      "Lasso adds people to Lists, not posts.",
    );
  });
});

describe("ToastHost", () => {
  const timers = { setTimer: () => 1, clearTimer: () => {} };

  it("renders title, second line, and actions with keycap chips", () => {
    const store = createToastStore(timers);
    const run = vi.fn();
    store.show({
      kind: "success",
      title: "Added 3 to Design Folks",
      line: "1 was already in the List",
      actions: [
        { label: "View List", run: () => {} },
        { label: "Undo", kbd: "Z", run },
      ],
    });
    const { getByText } = render(<ToastHost store={store} />);
    expect(getByText("Added 3 to Design Folks")).toBeTruthy();
    expect(getByText("1 was already in the List")).toBeTruthy();
    fireEvent.click(getByText("Undo"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("danger toasts are alerts with an explicit dismiss", async () => {
    const store = createToastStore(timers);
    store.show({ kind: "danger", title: "Nothing was added", line: "HTTP 500" });
    const { getByRole, getByLabelText, container } = render(<ToastHost store={store} />);
    expect(getByRole("alert")).toBeTruthy();
    fireEvent.click(getByLabelText("Dismiss"));
    await waitFor(() => expect(container.querySelector("output")).toBeNull());
  });
});
