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

  it("uses validated runtime events when an extension listener exists", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const rawAddListener = vi.fn();
    restore = installOnChanged({ addListener: rawAddListener });
    const previousRuntime = globalThis.chrome.runtime;
    globalThis.chrome.runtime = {
      id: "lasso-id",
      getManifest: () => ({ background: { service_worker: "worker.js" } }),
      getURL: (path: string) => `chrome-extension://lasso-id/${path}`,
      onMessage: { addListener, removeListener },
    } as unknown as typeof chrome.runtime;
    const onChange = vi.fn();

    const off = watchStorageKey("sync", "lasso:filter", onChange);
    const listener = addListener.mock.calls[0]?.[0] as (
      message: unknown,
      sender: chrome.runtime.MessageSender,
    ) => void;
    const change = {
      type: "lasso:storage-changed",
      area: "sync",
      key: "lasso:filter",
      oldValue: 7,
      newValue: 42,
    };
    listener(change, {
      id: "lasso-id",
      url: "chrome-extension://lasso-id/worker.js",
      origin: "chrome-extension://lasso-id",
    });
    listener(change, { id: "lasso-id", tab: { id: 7 } as chrome.tabs.Tab });
    listener(change, {
      id: "lasso-id",
      url: "chrome-extension://lasso-id/popup.html",
    });
    listener(change, { id: "foreign-id" });
    listener(
      {
        type: "lasso:storage-changed",
        area: "local",
        key: "lasso:settings-migration",
        oldValue: undefined,
        newValue: "complete",
      },
      { id: "lasso-id" },
    );

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ oldValue: 7, newValue: 42 });
    expect(rawAddListener).not.toHaveBeenCalled();
    off();
    expect(removeListener).toHaveBeenCalledWith(listener);
    globalThis.chrome.runtime = previousRuntime;
  });

  it("falls back when no service worker route can be resolved", () => {
    const listeners: Listener[] = [];
    restore = installOnChanged({ addListener: (listener) => listeners.push(listener) });
    const previousRuntime = globalThis.chrome.runtime;
    globalThis.chrome.runtime = {
      id: "lasso-id",
      getManifest: () => ({ background: { service_worker: "" } }),
      getURL: () => "chrome-extension://lasso-id/worker.js",
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    } as unknown as typeof chrome.runtime;
    const onChange = vi.fn();

    watchStorageKey("sync", "lasso:filter", onChange);
    listeners[0]!({ "lasso:filter": { oldValue: 1, newValue: 2 } }, "sync");

    expect(onChange).toHaveBeenCalledWith({ oldValue: 1, newValue: 2 });
    globalThis.chrome.runtime = previousRuntime;
  });

  it("falls back when the manifest has no background section", () => {
    const listeners: Listener[] = [];
    restore = installOnChanged({ addListener: (listener) => listeners.push(listener) });
    const previousRuntime = globalThis.chrome.runtime;
    globalThis.chrome.runtime = {
      id: "lasso-id",
      getManifest: () => ({}),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    } as unknown as typeof chrome.runtime;
    const onChange = vi.fn();

    watchStorageKey("sync", "lasso:filter", onChange);
    listeners[0]!({ "lasso:filter": { newValue: 2 } }, "sync");

    expect(onChange).toHaveBeenCalledWith({ oldValue: undefined, newValue: 2 });
    globalThis.chrome.runtime = previousRuntime;
  });

  it("falls back when runtime manifest access throws", () => {
    const listeners: Listener[] = [];
    restore = installOnChanged({ addListener: (listener) => listeners.push(listener) });
    const previousRuntime = globalThis.chrome.runtime;
    globalThis.chrome.runtime = {
      id: "lasso-id",
      getManifest: () => {
        throw new Error("manifest unavailable");
      },
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    } as unknown as typeof chrome.runtime;
    const onChange = vi.fn();

    watchStorageKey("local", "lasso:settings", onChange);
    listeners[0]!({ "lasso:settings": { newValue: 2 } }, "local");

    expect(onChange).toHaveBeenCalledWith({ oldValue: undefined, newValue: 2 });
    globalThis.chrome.runtime = previousRuntime;
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
