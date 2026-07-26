import { act, render, waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type SettingsChangeOrigin,
  type LassoSettings,
  type SettingsStore,
} from "@/core/settings";
import { type SettingsDraft, useSettingsDraft } from "@/options/use-settings-draft";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Harness({
  settings,
  expose,
}: {
  settings: SettingsStore;
  expose: (draft: SettingsDraft) => void;
}) {
  expose(useSettingsDraft(settings));
  return null as unknown as ComponentChildren;
}

describe("useSettingsDraft", () => {
  it("keeps an early edit visible when its write fails before the initial read", async () => {
    const read = deferred<LassoSettings>();
    const write = deferred<LassoSettings>();
    const settings: SettingsStore = {
      get: () => read.promise,
      set: () => write.promise,
      subscribe: () => () => {},
    };
    let draft: SettingsDraft | undefined;
    render(<Harness settings={settings} expose={(next) => (draft = next)} />);

    act(() => draft!.patch({ highContrast: true }));
    expect(draft?.current?.highContrast).toBe(true);
    write.reject(new Error("storage unavailable"));

    await waitFor(() => expect(draft?.saveError).toBe(true));
    expect(draft?.current?.highContrast).toBe(true);

    read.resolve(DEFAULT_SETTINGS);
    await act(async () => {
      await Promise.resolve();
    });
    expect(draft?.current?.highContrast).toBe(true);
  });

  it("accepts a subscribed saved snapshot with a rotated Mirror identity", async () => {
    const write = deferred<LassoSettings>();
    const initial = {
      ...DEFAULT_SETTINGS,
      convexUrl: "https://first.convex.cloud",
      convexDeviceKey: "first-key",
      mirrorConfigId: "mirror-first",
    };
    const rotated = {
      ...initial,
      convexDeviceKey: "second-key",
      mirrorConfigId: "mirror-second",
    };
    let publish: ((snapshot: LassoSettings, origin?: SettingsChangeOrigin) => void) | undefined;
    const settings: SettingsStore = {
      get: async () => initial,
      set: () => write.promise,
      subscribe: (listener) => {
        publish = listener;
        return () => {};
      },
    };
    const onSaved = vi.fn();
    let draft: SettingsDraft | undefined;
    render(<Harness settings={settings} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(initial));

    act(() => draft!.patch({ convexDeviceKey: "second-key" }, onSaved));
    act(() => publish?.(rotated));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(draft?.current).toEqual(rotated);
    write.resolve(rotated);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("acknowledges P2's local snapshot after P1 rejects", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const initial = { ...DEFAULT_SETTINGS, mirrorConfigId: "mirror-first" };
    const accepted = { ...initial, highContrast: true };
    const writes = [first, second];
    let publish: ((snapshot: LassoSettings, origin?: SettingsChangeOrigin) => void) | undefined;
    const settings: SettingsStore = {
      get: async () => initial,
      set: () => writes.shift()!.promise,
      subscribe: (listener) => {
        publish = listener;
        return () => {};
      },
    };
    const onSaved = vi.fn();
    let draft: SettingsDraft | undefined;
    render(<Harness settings={settings} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(initial));

    act(() => {
      draft!.patch({ backend: "dom" });
      draft!.patch({ highContrast: true }, onSaved);
    });
    first.reject(new Error("storage unavailable"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => publish?.(accepted, "local"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(draft?.current).toEqual(accepted);
    second.resolve(accepted);
  });

  it("merges a partial pill position before it writes", async () => {
    let stored = DEFAULT_SETTINGS;
    const settings: SettingsStore = {
      get: async () => stored,
      set: async (patch) => {
        stored = mergeSettings(stored, patch);
        return stored;
      },
      subscribe: () => () => {},
    };
    let draft: SettingsDraft | undefined;
    render(<Harness settings={settings} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(DEFAULT_SETTINGS));

    act(() => draft!.patch({ pillPosition: { x: 12 } }));

    await waitFor(() => expect(draft?.current?.pillPosition).toEqual({ x: 12, y: 96 }));
  });

  it("drops an old store's late write after a store swap", async () => {
    const oldWrite = deferred<LassoSettings>();
    const first: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => oldWrite.promise,
      subscribe: () => () => {},
    };
    const newest = { ...DEFAULT_SETTINGS, backend: "graphql" as const };
    const second: SettingsStore = {
      get: async () => newest,
      set: async () => newest,
      subscribe: () => () => {},
    };
    let draft: SettingsDraft | undefined;
    const view = render(<Harness settings={first} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(DEFAULT_SETTINGS));
    act(() => draft!.patch({ highContrast: true }));

    view.rerender(<Harness settings={second} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(newest));
    oldWrite.resolve({ ...DEFAULT_SETTINGS, highContrast: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(draft?.current).toEqual(newest);
  });

  it("drops an old store's late subscription callback after a store swap", async () => {
    let publishOld: ((snapshot: LassoSettings) => void) | undefined;
    const first: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: async () => DEFAULT_SETTINGS,
      subscribe: (listener) => {
        publishOld = listener;
        return () => {};
      },
    };
    const newest = { ...DEFAULT_SETTINGS, backend: "graphql" as const };
    const second: SettingsStore = {
      get: async () => newest,
      set: async () => newest,
      subscribe: () => () => {},
    };
    let draft: SettingsDraft | undefined;
    const view = render(<Harness settings={first} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(DEFAULT_SETTINGS));

    view.rerender(<Harness settings={second} expose={(next) => (draft = next)} />);
    await waitFor(() => expect(draft?.current).toEqual(newest));
    act(() => publishOld?.({ ...DEFAULT_SETTINGS, highContrast: true }));

    expect(draft?.current).toEqual(newest);
  });
});
