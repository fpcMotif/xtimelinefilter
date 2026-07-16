import { render } from "@testing-library/preact";
import { useRef } from "preact/hooks";
import { describe, expect, it } from "vitest";

import { useFocusTrap } from "@/ui/use-focus-trap";

function Dialog({ empty = false }: { empty?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog">
      {!empty && (
        <>
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </>
      )}
    </div>
  );
}

function UnattachedRefDialog() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return <p>the ref below is never wired to a DOM node</p>;
}

function tab(target: Element, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useFocusTrap", () => {
  it("moves focus to the first focusable element on mount", () => {
    const { getByText } = render(<Dialog />);
    expect(document.activeElement).toBe(getByText("First"));
  });

  it("falls back to the container itself when nothing inside is focusable", () => {
    const { getByRole } = render(<Dialog empty />);
    const container = getByRole("dialog");
    expect(document.activeElement).toBe(container);
    expect(container.tabIndex).toBe(-1);
  });

  it("does nothing when the container has no ref attached", () => {
    expect(() => render(<UnattachedRefDialog />)).not.toThrow();
  });

  it("wraps Tab on the last element to the first", () => {
    const { getByText } = render(<Dialog />);
    const last = getByText("Last");
    last.focus();
    const event = tab(last, false);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByText("First"));
  });

  it("wraps Shift+Tab on the first element to the last", () => {
    const { getByText } = render(<Dialog />);
    const first = getByText("First");
    first.focus();
    const event = tab(first, true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByText("Last"));
  });

  it("does not wrap Tab from a non-last element", () => {
    const { getByText } = render(<Dialog />);
    const middle = getByText("Middle");
    middle.focus();
    const event = tab(middle, false);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);
  });

  it("does not wrap Shift+Tab from a non-first element", () => {
    const { getByText } = render(<Dialog />);
    const middle = getByText("Middle");
    middle.focus();
    const event = tab(middle, true);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(middle);
  });

  it("ignores non-Tab keys", () => {
    const { getByText } = render(<Dialog />);
    const first = getByText("First");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    first.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("is a no-op on Tab when there are no focusable elements", () => {
    const { getByRole } = render(<Dialog empty />);
    const container = getByRole("dialog");
    const event = tab(container, false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("restores focus to the previously focused element on unmount", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(<Dialog />);
    expect(document.activeElement).not.toBe(outside);

    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("tracks focus through an open shadow root (activeElement is the host at document level)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);

    render(<Dialog />, { container: mount });
    const first = shadow.querySelector<HTMLButtonElement>("button")!;
    expect(shadow.activeElement).toBe(first);

    const buttons = shadow.querySelectorAll<HTMLButtonElement>("button");
    const last = buttons[buttons.length - 1]!;
    last.focus();
    const event = tab(last, false);
    expect(event.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(first);
    host.remove();
  });

  it("skips restoring focus when the previously focused element was disconnected", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    const { unmount } = render(<Dialog />);
    outside.remove();

    expect(() => unmount()).not.toThrow();
    expect(document.activeElement).not.toBe(outside);
  });
});
