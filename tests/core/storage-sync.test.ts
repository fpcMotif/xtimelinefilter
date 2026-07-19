import { afterEach, describe, expect, it, vi } from "vitest";

import { watchStorageKey } from "@/core/storage-sync";

import { stubOnChanged as installOnChanged } from "../helpers/chrome-fake";

type Listener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
) => void;

describe("watchStorageKey", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("is a no-op (returns a no-throw unsubscribe) when onChanged is absent", () => {
    // The shared chrome mock ships no onChanged, so this exercises the early return.
    const off = watchStorageKey("sync", "lasso:filter", () => {});
    expect(() => off()).not.toThrow();
  });

  it("fires onChange only for a matching area + key, ignoring others", () => {
    const listeners: Listener[] = [];
    restore = installOnChanged({
      addListener: (l) => listeners.push(l),
      removeListener: () => {},
    });
    const onChange = vi.fn();
    watchStorageKey("sync", "lasso:filter", onChange);

    // wrong area — ignored
    listeners[0]!({ "lasso:filter": { newValue: 1 } }, "local");
    // right area, different key — ignored
    listeners[0]!({ "lasso:settings": { newValue: 2 } }, "sync");
    // match
    listeners[0]!({ "lasso:filter": { oldValue: 7, newValue: 42 } }, "sync");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ oldValue: 7, newValue: 42 });
  });

  it("passes undefined old/new values when the changed entry is empty", () => {
    const listeners: Listener[] = [];
    restore = installOnChanged({ addListener: (l) => listeners.push(l), removeListener: () => {} });
    const onChange = vi.fn();
    watchStorageKey("local", "lasso:lists", onChange);
    listeners[0]!({ "lasso:lists": {} }, "local");
    expect(onChange).toHaveBeenCalledWith({ oldValue: undefined, newValue: undefined });
  });

  it("removeListener on unsubscribe, and tolerates a missing removeListener", () => {
    const removeListener = vi.fn();
    restore = installOnChanged({ addListener: () => {}, removeListener });
    const off = watchStorageKey("sync", "lasso:filter", () => {});
    off();
    expect(removeListener).toHaveBeenCalledTimes(1);

    restore();
    restore = installOnChanged({ addListener: () => {} }); // no removeListener
    const off2 = watchStorageKey("sync", "lasso:filter", () => {});
    expect(() => off2()).not.toThrow();
  });

  it("never throws when storage access blows up (torn-down context)", () => {
    const chromeMock = globalThis as unknown as {
      chrome: { storage: Record<string, unknown> };
    };
    const realStorage = chromeMock.chrome.storage;
    // A torn-down extension context: touching .onChanged throws.
    Object.defineProperty(chromeMock.chrome, "storage", {
      configurable: true,
      get() {
        throw new Error("Extension context invalidated");
      },
    });
    restore = () => {
      Object.defineProperty(chromeMock.chrome, "storage", {
        configurable: true,
        writable: true,
        value: realStorage,
      });
    };
    const off = watchStorageKey("sync", "lasso:filter", () => {});
    expect(() => off()).not.toThrow();
  });
});
