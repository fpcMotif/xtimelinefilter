import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { createSettings, type LassoSettings, type SettingsStore } from "@/core/settings";
import { PopupApp } from "@/popup/PopupApp";

import { createMemoryArea as fakeStorage } from "../helpers/chrome-fake";

const KEY = "lasso:filter";

function configuredSettings(initial: Partial<LassoSettings> = {}) {
  let current: LassoSettings = {
    backend: "rest",
    activation: "auto",
    highContrast: false,
    convexUrl: "https://mirror.example",
    convexDeviceKey: "device-key",
    mirrorConfigId: "mirror-1",
    surfaces: { pill: true, palette: false },
    pillPosition: { x: 24, y: 96 },
    paletteHotkey: "mod+shift+f",
    ...initial,
  };
  const subscribers = new Set<(next: LassoSettings) => void>();
  const settings: SettingsStore = {
    get: vi.fn(async () => current),
    set: vi.fn(async (patch) => ({ ...current, ...patch })),
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
  return {
    settings,
    emit(patch: Partial<LassoSettings>) {
      current = { ...current, ...patch };
      for (const listener of subscribers) listener(current);
    },
  };
}

describe("PopupApp — the toolbar remote", () => {
  it("active tabs show the Active badge, no wake button, and no off-x hint", async () => {
    const r = render(
      <PopupApp queryState={async () => "active"} wake={async () => {}} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    expect(r.getByText("Active on x.com")).toBeTruthy();
    expect(r.queryByText("Asleep — click to wake")).toBeNull();
    expect(r.queryByText("Open x.com to use Lasso")).toBeNull();
  });

  it("asleep tabs offer click-to-wake and flip to active", async () => {
    const wake = vi.fn(async () => true);
    const r = render(
      <PopupApp queryState={async () => "asleep"} wake={wake} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Asleep — click to wake")).toBeTruthy());
    fireEvent.click(r.getByText("Asleep — click to wake"));
    expect(wake).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
  });

  it("stays asleep when wake rolls back", async () => {
    const wake = vi.fn(async () => false);
    const r = render(
      <PopupApp queryState={async () => "asleep"} wake={wake} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Asleep — click to wake")).toBeTruthy());
    fireEvent.click(r.getByText("Asleep — click to wake"));
    await waitFor(() => expect(r.getByText("Asleep")).toBeTruthy());
    expect(r.queryByText("Active on x.com")).toBeNull();
  });

  it("stays asleep when wake rejects", async () => {
    const wake = vi.fn(async () => {
      throw new Error("message port closed");
    });
    const r = render(
      <PopupApp queryState={async () => "asleep"} wake={wake} openOptions={() => {}} />,
    );
    const button = await waitFor(() => r.getByText("Asleep — click to wake"));
    fireEvent.click(button);
    await waitFor(() => expect(r.getByText("Asleep")).toBeTruthy());
    expect(r.queryByText("Active on x.com")).toBeNull();
  });

  it("does not update an unmounted popup after wake resolves", async () => {
    let resolveWake!: (awake: boolean) => void;
    const r = render(
      <PopupApp
        queryState={async () => "asleep"}
        wake={() =>
          new Promise((resolve) => {
            resolveWake = resolve;
          })
        }
        openOptions={() => {}}
      />,
    );
    fireEvent.click(await waitFor(() => r.getByText("Asleep — click to wake")));
    r.unmount();
    await act(async () => resolveWake(true));
  });

  it("does not revive an unmounted popup after wake rejects", async () => {
    let rejectWake!: (reason: unknown) => void;
    const r = render(
      <PopupApp
        queryState={async () => "asleep"}
        wake={() =>
          new Promise((_resolve, reject) => {
            rejectWake = reject;
          })
        }
        openOptions={() => {}}
      />,
    );
    fireEvent.click(await waitFor(() => r.getByText("Asleep — click to wake")));
    r.unmount();
    // The rejection lands after teardown: lifecycle.current is false, so the
    // catch arm must skip its setState("asleep") rather than poke a dead tree.
    await act(async () => {
      rejectWake(new Error("message port closed"));
    });
  });

  it("off-x tabs show the Off X badge and the open-x.com hint", async () => {
    const r = render(
      <PopupApp queryState={async () => "off-x"} wake={async () => {}} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Off X")).toBeTruthy());
    expect(r.getByText("Open x.com to use Lasso")).toBeTruthy();
  });

  it("settles to Off X when an injected state reader rejects", async () => {
    const r = render(
      <PopupApp
        queryState={async () => Promise.reject(new Error("tabs unavailable"))}
        wake={async () => {}}
        openOptions={() => {}}
      />,
    );
    await waitFor(() => expect(r.getByText("Off X")).toBeTruthy());
  });

  it("ignores a superseded tab-state read that resolves late", async () => {
    let resolveStale!: (s: "off-x") => void;
    const stale = () =>
      new Promise<"off-x">((resolve) => {
        resolveStale = resolve;
      });
    const filter = createFilterStore({ storage: fakeStorage() });
    const r = render(
      <PopupApp queryState={stale} wake={async () => {}} openOptions={() => {}} filter={filter} />,
    );
    // Swapping queryState tears down the first reader's effect (its mounted flag
    // flips false) and starts a fresh reader that wins with "active".
    r.rerender(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());

    // The stale read now settles; its guarded then-arm must drop the result
    // instead of clobbering the live "active" state with "off-x".
    await act(async () => resolveStale("off-x"));
    expect(r.getByText("Active")).toBeTruthy();
    expect(r.queryByText("Off X")).toBeNull();
  });

  it("ignores a superseded tab-state read that rejects late", async () => {
    let rejectStale!: (reason: unknown) => void;
    const stale = () =>
      new Promise<"off-x">((_resolve, reject) => {
        rejectStale = reject;
      });
    const filter = createFilterStore({ storage: fakeStorage() });
    const r = render(
      <PopupApp queryState={stale} wake={async () => {}} openOptions={() => {}} filter={filter} />,
    );
    r.rerender(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());

    // The stale read rejects after being superseded; the guarded catch-arm must
    // not settle the torn-down reader to "off-x".
    await act(async () => {
      rejectStale(new Error("tabs unavailable"));
    });
    expect(r.getByText("Active")).toBeTruthy();
    expect(r.queryByText("Off X")).toBeNull();
  });

  it("shows the loading dot and ellipsis before the tab state resolves", async () => {
    let resolveState!: (s: "active") => void;
    const r = render(
      <PopupApp
        queryState={() =>
          new Promise<"active">((resolve) => {
            resolveState = resolve;
          })
        }
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );
    expect(r.container.querySelector(".bg-border")).toBeTruthy();
    expect(r.getByText("…")).toBeTruthy();
    resolveState("active");
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
  });

  it("links to the full settings page", async () => {
    const openOptions = vi.fn();
    const r = render(
      <PopupApp queryState={async () => "off-x"} wake={async () => {}} openOptions={openOptions} />,
    );
    await waitFor(() => expect(r.getByText("All settings")).toBeTruthy());
    fireEvent.click(r.getByText("All settings"));
    expect(openOptions).toHaveBeenCalledTimes(1);
  });

  it("does NOT host the criteria chips — those live on the pill and in Settings", async () => {
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    expect(r.queryByLabelText("Video")).toBeNull();
    expect(r.queryByLabelText("Photo")).toBeNull();
    expect(r.queryByText(/off.*only.*hide/i)).toBeNull();
  });

  it("toggles the master Filter and persists to storage.sync", async () => {
    const storage = fakeStorage();
    const filter = createFilterStore({ storage });
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    const box = (await waitFor(() =>
      r.getByRole("checkbox", { name: /^Timeline filter:/ }),
    )) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(filter.state.value.enabled).toBe(false);
    await waitFor(() => {
      const persisted = storage.data[KEY] as { enabled: boolean } | undefined;
      expect(persisted?.enabled).toBe(false);
    });
  });

  it("keeps the visible filter count and state in the master control name", async () => {
    const filter = createFilterStore({ storage: fakeStorage() });
    filter.setOnlyMyLanguages(true);
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );

    const control = await waitFor(() =>
      r.getByRole("checkbox", { name: "Timeline filter: 1 filter armed" }),
    );
    fireEvent.click(control);
    expect(r.getByRole("checkbox", { name: "Timeline filter: 1 filter off" })).toBe(control);
  });

  it("toggles the language gate", async () => {
    const filter = createFilterStore({ storage: fakeStorage() });
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    fireEvent.click(await waitFor(() => r.getByLabelText("Only my languages")));
    expect(filter.state.value.onlyMyLanguages).toBe(true);
  });

  it("toggles compact-hidden mode", async () => {
    const filter = createFilterStore({ storage: fakeStorage() });
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    const box = (await waitFor(() => r.getByLabelText("Hide filtered posts"))) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(filter.state.value.compactHidden).toBe(true);
  });

  it("shows the empty presets hint when none are saved", async () => {
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );
    await waitFor(() => expect(r.getByText("Save one from the funnel on x.com")).toBeTruthy());
  });

  it("applies a saved preset on click, labels singular counts, and acknowledges", async () => {
    vi.useFakeTimers();
    try {
      const filter = createFilterStore({ storage: fakeStorage() });
      filter.setOnlyMyLanguages(true); // armed = 1 → "filter armed"
      filter.savePreset("Reading");
      const apply = vi.spyOn(filter, "applyPreset");
      const r = render(
        <PopupApp
          queryState={async () => "active"}
          wake={async () => {}}
          openOptions={() => {}}
          filter={filter}
        />,
      );
      expect(r.getByText("filter armed")).toBeTruthy();
      fireEvent.click(r.getByRole("button", { name: "Reading" }));
      expect(apply).toHaveBeenCalledTimes(1);
      expect(r.getByText("Applied · Reading")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(r.queryByText("Applied · Reading")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("labels plural counts by default (0 filters armed)", async () => {
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );
    await waitFor(() => expect(r.getByText("filters armed")).toBeTruthy());
  });

  it("dims the armed count to 'filter off' when the master switch is off", async () => {
    const filter = createFilterStore({ storage: fakeStorage() });
    filter.setEnabled(false);
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    await waitFor(() => expect(r.getByText("filter off")).toBeTruthy());
    expect(r.queryByText(/filters? armed/)).toBeNull();
  });

  it("keeps the high-contrast page attribute live and releases its subscription", async () => {
    let current: LassoSettings = {
      ...(await createSettings(fakeStorage()).get()),
      highContrast: false,
    };
    const subscribers = new Set<(next: LassoSettings) => void>();
    const unsubscribe = vi.fn(() => {});
    const settings: SettingsStore = {
      get: vi.fn(async () => current),
      set: vi.fn(async (patch) => ({ ...current, ...patch })),
      subscribe: vi.fn((listener) => {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
          unsubscribe();
        };
      }),
    };
    const emit = (highContrast: boolean) => {
      current = { ...current, highContrast };
      for (const listener of subscribers) listener(current);
    };

    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
      />,
    );
    await waitFor(() => expect(document.documentElement.hasAttribute("data-hc")).toBe(false));

    emit(true);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-hc")).toBe(true));
    emit(false);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-hc")).toBe(false));
    emit(true);
    await waitFor(() => expect(document.documentElement.hasAttribute("data-hc")).toBe(true));

    r.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    emit(false);
    expect(document.documentElement.hasAttribute("data-hc")).toBe(false);
  });

  it("leaves the contrast attribute untouched when the settings read rejects", async () => {
    const { settings } = configuredSettings();
    settings.get = vi.fn(async () => Promise.reject(new Error("settings unavailable")));
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
      />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    await waitFor(() => expect(settings.get).toHaveBeenCalledTimes(1));
    expect(document.documentElement.hasAttribute("data-hc")).toBe(false);
  });

  it("ignores a high-contrast emit that arrives after the popup unmounts", async () => {
    const { settings } = configuredSettings();
    let notify!: (next: LassoSettings) => void;
    // A leaky teardown: the watcher keeps a live handle after the popup is gone.
    settings.subscribe = (listener) => {
      notify = listener;
      return () => {};
    };
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
      />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    expect(document.documentElement.hasAttribute("data-hc")).toBe(false);

    const snapshot = await settings.get();
    r.unmount();
    // mounted is now false for the settings effect; the guard must drop this
    // emit so the torn-down popup never re-toggles the shared page attribute.
    act(() => notify({ ...snapshot, highContrast: true }));
    expect(document.documentElement.hasAttribute("data-hc")).toBe(false);
  });
});

describe("Mirror status row — instant sync observability (ADR-0009)", () => {
  const base = {
    queryState: async () => "active" as const,
    wake: async () => {},
    openOptions: () => {},
  };

  it("shows the synced age when the last Mirror write succeeded", async () => {
    const { settings } = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={async () => ({
          ok: true,
          at: Date.UTC(2026, 6, 2, 11, 57),
          configId: "mirror-1",
        })}
        now={() => Date.UTC(2026, 6, 2, 12, 0)}
      />,
    );
    await waitFor(() => expect(r.getByText("Last Mirror write succeeded 3m ago")).toBeTruthy());
  });

  it("does not certify Mirror B with Mirror A's persisted status", async () => {
    const { settings } = configuredSettings({
      convexUrl: "https://mirror-b.example",
      convexDeviceKey: "device-key-b",
      mirrorConfigId: "mirror-b",
    });
    const mirrorStatus = vi.fn(async () => ({
      ok: true as const,
      at: Date.now(),
      configId: "mirror-a",
    }));
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={mirrorStatus}
      />,
    );

    await waitFor(() => expect(mirrorStatus).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(settings.get).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(r.queryByText(/Last Mirror write/)).toBeNull();
  });

  it("falls back to the wall clock when no now() is injected", async () => {
    const { settings } = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={async () => ({ ok: true, at: Date.now(), configId: "mirror-1" })}
      />,
    );
    await waitFor(() => expect(r.getByText("Last Mirror write succeeded just now")).toBeTruthy());
  });

  it("flags a failing Mirror and clicks through to settings", async () => {
    const openOptions = vi.fn();
    const { settings } = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        openOptions={openOptions}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={async () => ({ ok: false, at: 1, configId: "mirror-1" })}
      />,
    );
    await waitFor(() =>
      expect(r.getByText("Last Mirror write failed — open settings")).toBeTruthy(),
    );
    fireEvent.click(r.getByText("Last Mirror write failed — open settings"));
    expect(openOptions).toHaveBeenCalledTimes(1);
  });

  it("replaces a same-config success when a later Mirror write fails", async () => {
    let emitStatus!: (status: { ok: boolean; at: number; configId: string }) => void;
    const unsubscribe = vi.fn();
    const { settings } = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={async () => ({ ok: true, at: Date.now(), configId: "mirror-1" })}
        subscribeMirrorStatus={(listener) => {
          emitStatus = listener;
          return unsubscribe;
        }}
      />,
    );
    await waitFor(() => expect(r.getByText("Last Mirror write succeeded just now")).toBeTruthy());

    act(() => emitStatus({ ok: false, at: Date.now(), configId: "mirror-1" }));
    await waitFor(() =>
      expect(r.getByText("Last Mirror write failed — open settings")).toBeTruthy(),
    );
    r.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not let a stale read overwrite a newer subscribed status", async () => {
    let resolveRead!: (status: { ok: true; at: number; configId: string }) => void;
    const { settings } = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={() =>
          new Promise((resolve) => {
            resolveRead = resolve;
          })
        }
        subscribeMirrorStatus={(listener) => {
          listener({ ok: false, at: Date.now(), configId: "mirror-1" });
          return () => {};
        }}
      />,
    );
    await waitFor(() =>
      expect(r.getByText("Last Mirror write failed — open settings")).toBeTruthy(),
    );

    await act(async () => {
      resolveRead({ ok: true, at: Date.now(), configId: "mirror-1" });
    });
    expect(r.queryByText(/Last Mirror write succeeded/)).toBeNull();
    expect(r.getByText("Last Mirror write failed — open settings")).toBeTruthy();
  });

  it("fences a stale mirror watcher after its subscription is superseded", async () => {
    const { settings } = configuredSettings();
    const readOk = vi.fn(async () => ({ ok: true as const, at: Date.now(), configId: "mirror-1" }));
    let staleEmit!: (status: { ok: boolean; at: number; configId: string }) => void;
    const props = {
      ...base,
      filter: createFilterStore({ storage: fakeStorage() }),
      settings,
      mirrorStatus: readOk,
    };
    const r = render(
      <PopupApp
        {...props}
        subscribeMirrorStatus={(listener) => {
          staleEmit = listener;
          return () => {};
        }}
      />,
    );
    await waitFor(() => expect(r.getByText(/Last Mirror write succeeded/)).toBeTruthy());

    // Swapping the watcher tears down the first subscription's effect (its
    // mounted flag flips false), but the leaky unsubscribe leaves staleEmit
    // wired to the dead closure.
    r.rerender(<PopupApp {...props} subscribeMirrorStatus={() => () => {}} />);
    await waitFor(() => expect(r.getByText(/Last Mirror write succeeded/)).toBeTruthy());

    // The fenced watcher emits a failure; the guard must drop it so the live
    // "succeeded" row survives instead of flipping to "failed".
    act(() => staleEmit({ ok: false, at: Date.now(), configId: "mirror-1" }));
    expect(r.queryByText("Last Mirror write failed — open settings")).toBeNull();
    expect(r.getByText(/Last Mirror write succeeded/)).toBeTruthy();
  });

  it("renders no Mirror row when the status is null or the reader is absent", async () => {
    const withNull = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        mirrorStatus={async () => null}
      />,
    );
    await waitFor(() => expect(withNull.getByText("Active")).toBeTruthy());
    expect(withNull.queryByText(/Mirror/)).toBeNull();

    const withoutReader = render(
      <PopupApp {...base} filter={createFilterStore({ storage: fakeStorage() })} />,
    );
    await waitFor(() => expect(withoutReader.getByText("Active")).toBeTruthy());
    expect(withoutReader.queryByText(/Mirror/)).toBeNull();
  });

  it("leaves the Mirror row absent when its reader rejects", async () => {
    const { settings } = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={settings}
        mirrorStatus={async () => Promise.reject(new Error("storage unavailable"))}
      />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    expect(r.queryByText(/Mirror/)).toBeNull();
  });

  it("hides a persisted Mirror status when another surface clears either credential", async () => {
    const configured = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={configured.settings}
        mirrorStatus={async () => ({ ok: true, at: Date.now(), configId: "mirror-1" })}
      />,
    );
    await waitFor(() => expect(r.getByText("Last Mirror write succeeded just now")).toBeTruthy());

    configured.emit({ convexDeviceKey: "" });
    await waitFor(() => expect(r.queryByText(/Last Mirror write succeeded/)).toBeNull());
  });

  it("does not call an old status current after another surface changes the configured Mirror", async () => {
    const configured = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={configured.settings}
        mirrorStatus={async () => ({ ok: true, at: Date.now(), configId: "mirror-1" })}
      />,
    );
    await waitFor(() => expect(r.getByText("Last Mirror write succeeded just now")).toBeTruthy());

    configured.emit({
      convexUrl: "https://other-mirror.example",
      mirrorConfigId: "mirror-2",
    });
    await waitFor(() => expect(r.queryByText(/Last Mirror write succeeded/)).toBeNull());
  });

  it("fences a late status read after an external settings transition", async () => {
    let resolveStatus!: (status: { ok: true; at: number; configId: string }) => void;
    const configured = configuredSettings();
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={configured.settings}
        mirrorStatus={() =>
          new Promise((resolve) => {
            resolveStatus = resolve;
          })
        }
      />,
    );

    configured.emit({
      convexUrl: "https://other-mirror.example",
      mirrorConfigId: "mirror-2",
    });
    resolveStatus({ ok: true, at: Date.now(), configId: "mirror-1" });
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    expect(r.queryByText(/Last Mirror write succeeded/)).toBeNull();
  });

  it("does not restore an old configured snapshot after an external disable wins the read race", async () => {
    let resolveRead!: (settings: LassoSettings) => void;
    const staleConfigured = configuredSettings();
    staleConfigured.settings.get = vi.fn(
      () =>
        new Promise<LassoSettings>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        settings={staleConfigured.settings}
        mirrorStatus={async () => ({ ok: true, at: Date.now(), configId: "mirror-1" })}
      />,
    );

    staleConfigured.emit({ convexUrl: "" });
    resolveRead({
      backend: "rest",
      activation: "auto",
      highContrast: false,
      convexUrl: "https://mirror.example",
      convexDeviceKey: "device-key",
      mirrorConfigId: "mirror-1",
      surfaces: { pill: true, palette: false },
      pillPosition: { x: 24, y: 96 },
      paletteHotkey: "mod+shift+f",
    });

    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    expect(r.queryByText(/Last Mirror write succeeded/)).toBeNull();
  });
});
