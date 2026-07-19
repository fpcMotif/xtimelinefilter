import { describe, expect, it, vi } from "vitest";

import { createHighContrastHosts } from "@/content/high-contrast-hosts";
import { DEFAULT_SETTINGS, type LassoSettings, type SettingsStore } from "@/core/settings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeSettings(get = Promise.resolve(DEFAULT_SETTINGS)) {
  let listener: ((settings: LassoSettings) => void) | undefined;
  const unsubscribe = vi.fn();
  const settings: SettingsStore = {
    get: vi.fn(() => get),
    set: vi.fn(),
    subscribe: vi.fn((cb) => {
      listener = cb;
      return unsubscribe;
    }),
  };
  return {
    settings,
    emit: (next: Partial<LassoSettings>) => listener?.({ ...DEFAULT_SETTINGS, ...next }),
    unsubscribe,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createHighContrastHosts", () => {
  it("uses the boot value at once, refreshes it, and applies later registrations", async () => {
    const fresh = deferred<LassoSettings>();
    const { settings } = fakeSettings(fresh.promise);
    const hosts = createHighContrastHosts(settings, false);
    const first = document.createElement("div");
    hosts.register(first);
    expect(first.hasAttribute("data-hc")).toBe(false);

    fresh.resolve({ ...DEFAULT_SETTINGS, highContrast: true });
    await flush();
    expect(first.hasAttribute("data-hc")).toBe(true);

    const late = document.createElement("div");
    hosts.register(late);
    expect(late.hasAttribute("data-hc")).toBe(true);
    expect(settings.subscribe).toHaveBeenCalledTimes(1);
  });

  it("updates all registered hosts from either settings callback", () => {
    const { settings, emit } = fakeSettings();
    const hosts = createHighContrastHosts(settings, false);
    const first = document.createElement("div");
    const second = document.createElement("div");
    hosts.register(first);
    hosts.register(second);

    emit({ highContrast: true });
    expect(first.hasAttribute("data-hc")).toBe(true);
    expect(second.hasAttribute("data-hc")).toBe(true);

    emit({ highContrast: false });
    expect(first.hasAttribute("data-hc")).toBe(false);
    expect(second.hasAttribute("data-hc")).toBe(false);
  });

  it("unregisters and disposes idempotently", () => {
    const { settings, emit, unsubscribe } = fakeSettings();
    const hosts = createHighContrastHosts(settings, false);
    const host = document.createElement("div");
    const unregister = hosts.register(host);
    unregister();
    unregister();
    emit({ highContrast: true });
    expect(host.hasAttribute("data-hc")).toBe(false);

    hosts.dispose();
    hosts.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const late = document.createElement("div");
    const unregisterLate = hosts.register(late);
    unregisterLate();
    expect(late.hasAttribute("data-hc")).toBe(false);
  });

  it("ignores stale or disposed initial reads and swallowed read failures", async () => {
    const stale = deferred<LassoSettings>();
    const fake = fakeSettings(stale.promise);
    const hosts = createHighContrastHosts(fake.settings, false);
    const host = document.createElement("div");
    hosts.register(host);
    fake.emit({ highContrast: true });
    stale.resolve({ ...DEFAULT_SETTINGS, highContrast: false });
    await flush();
    expect(host.hasAttribute("data-hc")).toBe(true);

    const afterDispose = deferred<LassoSettings>();
    const disposed = createHighContrastHosts(fakeSettings(afterDispose.promise).settings, false);
    const removed = document.createElement("div");
    disposed.register(removed);
    disposed.dispose();
    afterDispose.resolve({ ...DEFAULT_SETTINGS, highContrast: true });
    await flush();
    expect(removed.hasAttribute("data-hc")).toBe(false);

    const rejecting = createHighContrastHosts(
      fakeSettings(Promise.reject(new Error("nope"))).settings,
      false,
    );
    rejecting.dispose();
    await flush();
  });
});
