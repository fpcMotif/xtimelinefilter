import { afterEach, describe, expect, it, vi } from "vitest";

import { installHoverTracker } from "@/content/hover-tracker";

function mousemove(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
}

function tweetLike(): HTMLElement {
  const el = document.createElement("article");
  el.setAttribute("data-tweet", "");
  document.body.appendChild(el);
  return el;
}

const resolve = (el: Element | null): Element | null =>
  el?.hasAttribute("data-tweet") ? el : null;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("installHoverTracker", () => {
  it("reports every resolved hover, including nulls, via onHover", () => {
    const article = tweetLike();
    const other = document.createElement("div");
    document.body.appendChild(other);
    const onHover = vi.fn();
    const tracker = installHoverTracker({ resolve, onHover, fallback: () => null });

    mousemove(article);
    expect(onHover).toHaveBeenLastCalledWith(article);
    mousemove(other);
    expect(onHover).toHaveBeenLastCalledWith(null);

    tracker.dispose();
  });

  it("keeps the sticky target after the pointer drifts off it", () => {
    const article = tweetLike();
    const other = document.createElement("div");
    document.body.appendChild(other);
    const tracker = installHoverTracker({ resolve, onHover: () => {}, fallback: () => null });

    mousemove(article);
    expect(tracker.targetTweet()).toBe(article);
    mousemove(other); // resolve(other) is null — the sticky target is untouched
    expect(tracker.targetTweet()).toBe(article);

    tracker.dispose();
  });

  it("falls back once the sticky target leaves the document", () => {
    const article = tweetLike();
    const fallback = vi.fn(() => null);
    const tracker = installHoverTracker({ resolve, onHover: () => {}, fallback });

    mousemove(article);
    article.remove();
    expect(tracker.targetTweet()).toBeNull();
    expect(fallback).toHaveBeenCalled();

    tracker.dispose();
  });

  it("falls back to the caller's target when nothing has ever been hovered", () => {
    const focused = tweetLike();
    const fallback = vi.fn(() => focused);
    const tracker = installHoverTracker({ resolve: () => null, onHover: () => {}, fallback });

    expect(tracker.targetTweet()).toBe(focused);

    tracker.dispose();
  });

  it("release forgets the sticky target only when it matches", () => {
    const article = tweetLike();
    const other = tweetLike();
    const tracker = installHoverTracker({ resolve, onHover: () => {}, fallback: () => null });

    mousemove(article);
    tracker.release(other);
    expect(tracker.targetTweet()).toBe(article);

    tracker.release(article);
    expect(tracker.targetTweet()).toBeNull();

    tracker.dispose();
  });

  it("dispose removes the mousemove listener", () => {
    const article = tweetLike();
    const onHover = vi.fn();
    const tracker = installHoverTracker({ resolve, onHover, fallback: () => null });

    tracker.dispose();
    mousemove(article);
    expect(onHover).not.toHaveBeenCalled();
  });

  it("installs a capture-phase, passive listener", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const tracker = installHoverTracker({ resolve, onHover: () => {}, fallback: () => null });

    expect(addSpy).toHaveBeenCalledWith("mousemove", expect.any(Function), {
      capture: true,
      passive: true,
    });

    tracker.dispose();
    addSpy.mockRestore();
  });

  it("supports a custom doc, including an event with no target", () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const fakeDoc = {
      addEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
        listeners[type] = cb;
      }),
      removeEventListener: vi.fn(),
      contains: vi.fn(() => true),
    } as unknown as Document;
    const onHover = vi.fn();
    const article = tweetLike();
    const tracker = installHoverTracker({
      resolve,
      onHover,
      fallback: () => null,
      doc: fakeDoc,
    });

    listeners.mousemove!({ target: article });
    expect(onHover).toHaveBeenCalledWith(article);
    expect(tracker.targetTweet()).toBe(article);

    listeners.mousemove!({ target: undefined });
    expect(onHover).toHaveBeenLastCalledWith(null);

    tracker.dispose();
    expect(fakeDoc.removeEventListener).toHaveBeenCalledWith(
      "mousemove",
      listeners.mousemove,
      true,
    );
  });
});
