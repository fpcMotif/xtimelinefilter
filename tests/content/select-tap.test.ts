import { afterEach, describe, expect, it, vi } from "vitest";

import { installSelectTap } from "@/content/select-tap";
import { SYNTHETIC_EVENT_FLAG } from "@/content/selectors";

function click(target: EventTarget, init: MouseEventInit = {}): MouseEvent {
  const evt = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(evt, "isTrusted", { value: true });
  target.dispatchEvent(evt);
  return evt;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("installSelectTap", () => {
  it("ignores untrusted clicks", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const resolveTarget = vi.fn(() => article);
    const onToggle = vi.fn();
    const dispose = installSelectTap({ isActive: () => true, resolveTarget, onToggle });

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    article.dispatchEvent(evt);
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    dispose();
  });

  it("ignores Lasso's own flagged synthetic clicks", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const resolveTarget = vi.fn(() => article);
    const onToggle = vi.fn();
    const dispose = installSelectTap({ isActive: () => true, resolveTarget, onToggle });

    const evt = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "isTrusted", { value: true });
    Object.defineProperty(evt, SYNTHETIC_EVENT_FLAG, { value: true });
    article.dispatchEvent(evt);
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    dispose();
  });

  it("ignores non-primary clicks", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const resolveTarget = vi.fn(() => article);
    const onToggle = vi.fn();
    const dispose = installSelectTap({ isActive: () => true, resolveTarget, onToggle });

    click(article, { button: 1 });
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    dispose();
  });

  it("does nothing while inactive", () => {
    const resolveTarget = vi.fn();
    const onToggle = vi.fn();
    const dispose = installSelectTap({ isActive: () => false, resolveTarget, onToggle });

    click(document.body);
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    dispose();
  });

  it("does nothing when resolveTarget finds no article", () => {
    const onToggle = vi.fn();
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget: () => null,
      onToggle,
    });

    click(document.body);
    expect(onToggle).not.toHaveBeenCalled();

    dispose();
  });

  it("suppresses the native click and toggles when onToggle succeeds", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const onToggle = vi.fn();
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget: (t) => (t === article ? article : null),
      onToggle,
    });

    const evt = click(article);
    expect(onToggle).toHaveBeenCalledWith(article);
    expect(evt.defaultPrevented).toBe(true);

    dispose();
  });

  it("leaves the native click alone when onToggle reports nothing to toggle", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget: () => article,
      onToggle: () => false,
    });

    const evt = click(article);
    expect(evt.defaultPrevented).toBe(false);

    dispose();
  });

  it("suppresses the click when onToggle returns nothing (undefined counts as success)", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget: () => article,
      onToggle: () => {},
    });

    const evt = click(article);
    expect(evt.defaultPrevented).toBe(true);

    dispose();
  });

  it("resolves against composedPath()[0], not just e.target", () => {
    const inner = document.createElement("span");
    const article = document.createElement("article");
    article.appendChild(inner);
    document.body.appendChild(article);
    const resolveTarget = vi.fn(() => article);
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget,
      onToggle: () => {},
    });

    click(inner);
    expect(resolveTarget).toHaveBeenCalledWith(inner);

    dispose();
  });

  it("falls back to e.target when composedPath is absent", () => {
    const article = document.createElement("article");
    document.body.appendChild(article);
    let handler: ((e: unknown) => void) | undefined;
    vi.spyOn(document, "addEventListener").mockImplementation(((
      type: string,
      cb: EventListenerOrEventListenerObject,
    ) => {
      if (type === "click") handler = cb as unknown as (e: unknown) => void;
    }) as typeof document.addEventListener);
    const resolveTarget = vi.fn(() => article);
    installSelectTap({ isActive: () => true, resolveTarget, onToggle: () => {} });

    handler!({
      isTrusted: true,
      button: 0,
      composedPath: undefined,
      target: article,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    expect(resolveTarget).toHaveBeenCalledWith(article);

    vi.restoreAllMocks();
  });

  it("dispose removes the click listener", () => {
    const onToggle = vi.fn();
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget: () => document.body,
      onToggle,
    });

    dispose();
    click(document.body);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("supports a custom doc", () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const fakeDoc = {
      addEventListener: vi.fn((type: string, cb: (e: unknown) => void) => {
        listeners[type] = cb;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const onToggle = vi.fn();
    const article = document.createElement("article");
    const dispose = installSelectTap({
      isActive: () => true,
      resolveTarget: () => article,
      onToggle,
      doc: fakeDoc,
    });

    listeners.click!({
      isTrusted: true,
      button: 0,
      composedPath: () => [article],
      target: article,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    expect(onToggle).toHaveBeenCalledWith(article);

    dispose();
    expect(fakeDoc.removeEventListener).toHaveBeenCalledWith("click", listeners.click, true);
  });
});
