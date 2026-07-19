import { fireEvent, render, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { createToastStore } from "@/core/toast-store";
import { ActionBar, type ActionBarProps } from "@/ui/ActionBar";
import { RadioCard } from "@/ui/components/radio-card";
import { Switch } from "@/ui/components/switch";
import { ToastHost } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";

const authors = (...names: string[]): TweetAuthor[] => names.map((screenName) => ({ screenName }));

describe("TweetOverlay", () => {
  it("reflects selected state and toggles on click", () => {
    const onToggle = vi.fn();
    const { container, rerender } = render(
      <TweetOverlay screenName="alice" selected={false} visible onToggle={onToggle} />,
    );
    const btn = container.querySelector("button") as HTMLElement;
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<TweetOverlay screenName="alice" selected visible onToggle={onToggle} />);
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("reports keyboard focus so its coach tip can be exposed without hover", () => {
    const onFocusChange = vi.fn();
    const { getByLabelText } = render(
      <TweetOverlay
        screenName="alice"
        selected={false}
        visible
        onToggle={() => {}}
        onFocusChange={onFocusChange}
      />,
    );
    const button = getByLabelText("Select @alice");
    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(onFocusChange).toHaveBeenNthCalledWith(1, true);
    expect(onFocusChange).toHaveBeenNthCalledWith(2, false);
  });

  it("is hidden by default (pristine timeline) but selected checks stay visible", () => {
    const { container, rerender } = render(
      <TweetOverlay screenName="alice" selected={false} visible={false} onToggle={() => {}} />,
    );
    expect(container.querySelector("button")?.className).toContain("opacity-0");
    rerender(<TweetOverlay screenName="alice" selected visible={false} onToggle={() => {}} />);
    expect(container.querySelector("button")?.className).not.toContain("opacity-0");
  });

  it("renders the one-time first-hover tooltip when given", () => {
    const { getByLabelText, getByRole } = render(
      <TweetOverlay
        screenName="alice"
        selected={false}
        visible
        onToggle={() => {}}
        tooltip="Select — tip"
      />,
    );
    const tooltip = getByRole("tooltip");
    expect(tooltip.textContent).toBe("Select — tip");
    expect(getByLabelText("Select @alice").getAttribute("aria-describedby")).toBe(tooltip.id);
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

  it("moves focus into the review dialog and restores its trigger on close", async () => {
    function ControlledBar() {
      const [reviewOpen, setReviewOpen] = useState(false);
      return (
        <>
          <ActionBar
            {...barProps({ authors: authors("jane"), reviewOpen, onToggleReview: setReviewOpen })}
          />
          <button type="button" onClick={() => setReviewOpen(false)}>
            Close review
          </button>
        </>
      );
    }

    const screen = render(<ControlledBar />);
    const trigger = screen.getByLabelText("Review selected people");
    fireEvent.click(trigger);
    const remove = await screen.findByLabelText("Remove @jane");
    await waitFor(() => expect(document.activeElement).toBe(remove));

    remove.focus();
    fireEvent.click(screen.getByText("Close review"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps focus on the nearest review row after removing a person", async () => {
    function ControlledBar() {
      const [selected, setSelected] = useState(authors("jane", "bob", "zoe"));
      return (
        <ActionBar
          {...barProps({
            authors: selected,
            reviewOpen: true,
            onRemove: (screenName) =>
              setSelected((current) =>
                current.filter((author) => author.screenName !== screenName),
              ),
          })}
        />
      );
    }

    const screen = render(<ControlledBar />);
    const bob = screen.getByLabelText("Remove @bob");
    bob.focus();
    fireEvent.click(bob);

    const zoe = screen.getByLabelText("Remove @zoe");
    await waitFor(() => expect(document.activeElement).toBe(zoe));

    fireEvent.click(zoe);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Remove @jane")));
  });

  it("moves focus to Done after removing the final person in select mode", async () => {
    function ControlledBar() {
      const [selected, setSelected] = useState(authors("jane"));
      return (
        <ActionBar
          {...barProps({
            authors: selected,
            selectMode: true,
            reviewOpen: selected.length > 0,
            onRemove: () => setSelected([]),
          })}
        />
      );
    }

    const screen = render(<ControlledBar />);
    fireEvent.click(screen.getByLabelText("Remove @jane"));

    const done = screen.getByText("Done");
    await waitFor(() => expect(document.activeElement).toBe(done));
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

  it("moves focus to Stop when an assignment starts", async () => {
    function ControlledBar() {
      const [running, setRunning] = useState<ActionBarProps["running"]>(null);
      return (
        <ActionBar
          {...barProps({
            authors: authors("jane"),
            running,
            onAssign: () => setRunning({ current: 0, total: 1, listName: "Builders" }),
          })}
        />
      );
    }

    const screen = render(<ControlledBar />);
    const assign = screen.getByText("Add to List");
    assign.focus();
    fireEvent.click(assign);

    const stop = screen.getByText("Stop");
    await waitFor(() => expect(document.activeElement).toBe(stop));
  });

  it("announces assignment progress as one polite status", () => {
    const screen = render(
      <ActionBar
        {...barProps({
          authors: authors("a", "b"),
          running: { current: 2, total: 7, listName: "Design Folks" },
        })}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe("Adding 2 of 7 to Design Folks…");
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

  it("shows the count tooltip to keyboard focus and describes its trigger", async () => {
    const onCountHover = vi.fn(async () => "Lasso adds people to Lists, not posts.");
    const { getByText, findByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    const count = getByText("1 person selected");
    fireEvent.focus(count);
    const tooltip = await findByRole("tooltip");
    expect(count.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("clears the count tooltip on mouse leave", async () => {
    const onCountHover = vi.fn(async () => "tip");
    const { getByText, findByRole, queryByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    const count = getByText("1 person selected");
    fireEvent.mouseEnter(count);
    await findByRole("tooltip");
    fireEvent.mouseLeave(count);
    await waitFor(() => expect(queryByRole("tooltip")).toBeNull());
  });

  it("does not show a tooltip when its hover ends before the request resolves", async () => {
    let resolve!: (text: string | null) => void;
    const onCountHover = vi.fn(
      () =>
        new Promise<string | null>((done) => {
          resolve = done;
        }),
    );
    const { getByText, queryByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    const count = getByText("1 person selected");
    fireEvent.mouseEnter(count);
    fireEvent.mouseLeave(count);
    resolve("late tip");

    await Promise.resolve();
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("ignores a superseded count tooltip request", async () => {
    let resolveFirst!: (text: string | null) => void;
    let resolveSecond!: (text: string | null) => void;
    const onCountHover = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((done) => {
            resolveFirst = done;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string | null>((done) => {
            resolveSecond = done;
          }),
      );
    const { getByText, findByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    const count = getByText("1 person selected");
    fireEvent.mouseEnter(count);
    fireEvent.mouseLeave(count);
    fireEvent.mouseEnter(count);
    resolveFirst("stale");
    resolveSecond("fresh");

    expect((await findByRole("tooltip")).textContent).toBe("fresh");
  });

  it("handles a rejected count tooltip request", async () => {
    const onCountHover = vi.fn(async () => {
      throw new Error("tooltip unavailable");
    });
    const { getByText, queryByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    fireEvent.mouseEnter(getByText("1 person selected"));

    await Promise.resolve();
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("resolves a null count tooltip to no tooltip", async () => {
    const onCountHover = vi.fn(async () => null);
    const { getByText, queryByRole } = render(
      <ActionBar {...barProps({ authors: authors("a"), onCountHover })} />,
    );
    fireEvent.mouseEnter(getByText("1 person selected"));
    await Promise.resolve();
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("renders nothing extra when the count is hovered without an onCountHover handler", () => {
    const { getByText, queryByRole } = render(
      <ActionBar {...barProps({ authors: authors("a") })} />,
    );
    fireEvent.mouseEnter(getByText("1 person selected"));
    expect(queryByRole("tooltip")).toBeNull();
  });

  it("renders an <img> avatar when an avatarUrl is present", () => {
    const props = barProps({
      authors: [{ screenName: "jane", avatarUrl: "https://example.com/jane.png" }],
    });
    const { container } = render(<ActionBar {...props} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://example.com/jane.png");
    expect(img.getAttribute("alt")).toBe("@jane");
  });

  it("falls back to an initial avatar when no avatarUrl is present", () => {
    const { container, getByLabelText } = render(
      <ActionBar {...barProps({ authors: authors("Zoe") })} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(getByLabelText("@Zoe").textContent).toBe("Z");
  });
});

describe("RadioCard", () => {
  it("uses string children as the input's accessible name and fires onSelect", () => {
    const onSelect = vi.fn();
    const { getByLabelText } = render(
      <RadioCard name="surface" value="pill" checked={false} onSelect={onSelect}>
        Funnel pill
      </RadioCard>,
    );
    const input = getByLabelText("Funnel pill") as HTMLInputElement;
    expect(input.checked).toBe(false);
    fireEvent.click(input);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders non-string children without an aria-label and reflects checked", () => {
    const { container } = render(
      <RadioCard name="surface" checked onSelect={() => {}} class="extra" className="more">
        <strong>Rich label</strong>
      </RadioCard>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBeNull();
    expect(input.checked).toBe(true);
    expect(container.querySelector("strong")?.textContent).toBe("Rich label");
    expect(container.querySelector("label")?.className).toContain("extra");
    expect(container.querySelector("label")?.className).toContain("more");
  });
});

describe("Switch", () => {
  it("exposes the label as the accessible name and toggles via onChange", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <Switch label="Dark mode" checked={false} onChange={onChange} />,
    );
    const input = getByLabelText("Dark mode") as HTMLInputElement;
    expect(input.checked).toBe(false);
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("omits aria-label when no label is given (named by an enclosing label)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <label htmlFor="sw">
        Wrapped
        <Switch checked onChange={onChange} id="sw" class="a" className="b" />
      </label>,
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBeNull();
    expect(input.id).toBe("sw");
    expect(input.checked).toBe(true);
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledWith(false);
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
