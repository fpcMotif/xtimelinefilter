import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createCoach } from "@/core/coach";
import { createFilterStore } from "@/core/filter-store";
import {
  DEFAULT_SETTINGS,
  createSettings,
  type LassoSettings,
  type SettingsStore,
} from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import type { FoldersClient } from "@/options/folders-client";
import {
  ACTIVATION_COPY,
  BACKEND_COPY,
  CLEAR_CONFIRMATION,
  CONVEX_TEST_ERROR,
  CONVEX_URL_ERROR,
  DEFAULT_LIST_HINT,
  DEFAULT_LIST_NONE,
  isValidConvexUrl,
  OptionsApp,
  RAIL,
} from "@/options/OptionsApp";
import type { Folder } from "@/packages/folders/types";
import type { MembershipStoreProbe } from "@/packages/membership-store/types";

import { createMemoryArea as memoryArea } from "../helpers/chrome-fake";

/** A stable, inert Folders port — these tests care about the rest of the page. */
function fakeFoldersClient(folders: Folder[] = []): FoldersClient {
  return {
    async listFolders() {
      return folders;
    },
    async createFolder(name) {
      return {
        folderId: "fld_00000000000000000001",
        name,
        sortIndex: 0,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
      };
    },
    async renameFolder() {},
    async reorderFolders() {},
    async deleteFolder() {},
    async countFolder() {
      return 0;
    },
    async countFolderForDelete() {
      return { count: 0, shared: 0 };
    },
    async counts() {
      return { folders: folders.length, savedPosts: 0 };
    },
    async readFolderPage() {
      return { posts: [], nextCursor: null };
    },
  };
}

/** Reads one section's innerHTML by id, scoped to one render's own container. */
const sectionHtml = (r: { container: Element }, id: string): string =>
  r.container.querySelector(`#${id}`)!.innerHTML;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const cachedLists = () => ({
  [STORAGE_KEYS.cacheObservation]: {
    schema: 1,
    epoch: "00000000-0000-4000-8000-000000000001",
    sequence: 1,
  },
  [`${STORAGE_KEYS.lists}:100`]: {
    schema: 2,
    owner: { userId: "100", screenName: "me" },
    lists: [{ id: "9", name: "Design Folks" }],
    refreshedAt: 1,
    observation: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 },
  },
});

async function setup(
  seedLocal: Record<string, unknown> = {},
  mirrorProbe?: MembershipStoreProbe,
  seedSettings: Record<string, unknown> = {},
) {
  const local = memoryArea();
  const sync = memoryArea();
  Object.assign(local.data, seedLocal);
  // Tests run in dev, where local .env credentials seed the Mirror by design.
  // Explicit unset values keep test state independent from that machine-local config.
  sync.data[STORAGE_KEYS.settings] = {
    convexUrl: undefined,
    convexDeviceKey: undefined,
    ...seedSettings,
  };
  const settings = createSettings(sync);
  const coach = createCoach(local);
  const filter = createFilterStore({ storage: memoryArea() });
  const catalogReader = async () => {
    const row = seedLocal[`${STORAGE_KEYS.lists}:100`] as
      | {
          owner: { userId: string; screenName: string };
          lists: Array<{ id: string; name: string }>;
        }
      | undefined;
    return row ? [{ owner: row.owner, lists: row.lists }] : [];
  };
  const clearData = vi.fn(async () => ({ localCleared: true, syncCleared: true }));
  const r = render(
    <OptionsApp
      settings={settings}
      coach={coach}
      catalogReader={catalogReader}
      clearData={clearData}
      platform="other"
      filter={filter}
      mirrorProbe={mirrorProbe}
    />,
  );
  await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
  return { ...r, local, sync, settings, coach, filter, clearData };
}

describe("OptionsApp — story beat 9", () => {
  it("loads and saves through its browser-backed defaults", async () => {
    const r = render(<OptionsApp platform="other" />);

    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByLabelText("Higher-contrast buttons"));

    await waitFor(() =>
      expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(true),
    );
  });

  it("shows an error and restores confirmed controls after rejected setting writes", async () => {
    const settings: SettingsStore = {
      get: async () => ({
        ...DEFAULT_SETTINGS,
        convexUrl: undefined,
        convexDeviceKey: undefined,
      }),
      set: async () => Promise.reject(new Error("storage unavailable")),
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.change(r.getByText(BACKEND_COPY.graphql).querySelector("input") as HTMLInputElement, {
      target: { checked: true },
    });
    await waitFor(() =>
      expect(r.getByRole("alert").textContent).toBe("Could not save settings. Try again."),
    );
    expect(
      (r.getByText(BACKEND_COPY.rest).querySelector("input") as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.change(r.getByLabelText("Convex deployment URL"), {
      target: { value: "https://app.convex.cloud" },
    });
    await waitFor(() =>
      expect(r.getByRole("alert").textContent).toBe("Could not save settings. Try again."),
    );
    expect((r.getByLabelText("Convex deployment URL") as HTMLInputElement).value).toBe(
      "https://app.convex.cloud",
    );
  });

  it("surfaces a synchronous setting-write failure", async () => {
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => {
        throw new Error("storage unavailable");
      },
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByLabelText("Higher-contrast buttons"));
    await waitFor(() =>
      expect(r.getByRole("alert").textContent).toBe("Could not save settings. Try again."),
    );
    expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(false);
  });

  it("retries a failed settings load instead of leaving the skeleton forever", async () => {
    const settings: SettingsStore = {
      get: vi
        .fn<SettingsStore["get"]>()
        .mockRejectedValueOnce(new Error("storage unavailable"))
        .mockResolvedValueOnce(DEFAULT_SETTINGS),
      set: async () => DEFAULT_SETTINGS,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.getByRole("alert").textContent).toBe("Could not load settings."));
    fireEvent.click(r.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    expect(r.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("keeps a newer subscription snapshot over a late initial read", async () => {
    const initial = deferred<LassoSettings>();
    let subscriber: ((snapshot: LassoSettings) => void) | undefined;
    const settings: SettingsStore = {
      get: () => initial.promise,
      set: async () => DEFAULT_SETTINGS,
      subscribe: (cb) => {
        subscriber = cb;
        return () => {
          subscriber = undefined;
        };
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(subscriber).toBeTypeOf("function"));
    const newest = { ...DEFAULT_SETTINGS, activation: "on-demand" as const };
    subscriber!(newest);
    initial.resolve({ ...DEFAULT_SETTINGS, activation: "auto" });

    await waitFor(() => {
      const radio = r
        .getByText(ACTIVATION_COPY["on-demand"])
        .querySelector("input") as HTMLInputElement;
      expect(radio.checked).toBe(true);
    });
  });

  it("keeps W1 and reports W2 when W1 succeeds and the newer write fails", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi
        .fn<SettingsStore["set"]>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByLabelText("Higher-contrast buttons")); // W1
    fireEvent.change(r.getByText(BACKEND_COPY.graphql).querySelector("input") as HTMLInputElement, {
      target: { checked: true },
    }); // W2
    const w1 = { ...DEFAULT_SETTINGS, highContrast: true };
    for (const subscribe of subscribers) subscribe(w1); // settings' pre-promise local notify
    expect(
      (r.getByText(BACKEND_COPY.graphql).querySelector("input") as HTMLInputElement).checked,
    ).toBe(true);
    first.resolve(w1);
    await act(async () => {
      await Promise.resolve();
    });
    second.reject(new Error("storage unavailable"));

    await waitFor(() =>
      expect(r.getByRole("alert").textContent).toBe("Could not save settings. Try again."),
    );
    expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(true);
    expect(
      (r.getByText(BACKEND_COPY.rest).querySelector("input") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("ignores a late write rejection after unmount", async () => {
    const write = deferred<LassoSettings>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => write.promise,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByLabelText("Higher-contrast buttons"));
    r.unmount();
    write.reject(new Error("late storage failure"));
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("adopts successful queued P2 after external Q fenced P1", async () => {
    const p1 = deferred<LassoSettings>();
    const p2 = deferred<LassoSettings>();
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi
        .fn<SettingsStore["set"]>()
        .mockReturnValueOnce(p1.promise)
        .mockReturnValueOnce(p2.promise),
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByLabelText("Higher-contrast buttons")); // P1
    fireEvent.change(r.getByText(BACKEND_COPY.dom).querySelector("input") as HTMLInputElement, {
      target: { checked: true },
    }); // queued P2
    const q = { ...DEFAULT_SETTINGS, backend: "graphql" as const };
    for (const subscribe of subscribers) subscribe(q);
    p1.resolve(q); // stale P1 is fenced and returns Q
    const p2Value = { ...DEFAULT_SETTINGS, highContrast: true, backend: "dom" as const };
    p2.resolve(p2Value); // P2 persisted after Q, so it is now authority

    await waitFor(() => {
      expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(true);
      expect(
        (r.getByText(BACKEND_COPY.dom).querySelector("input") as HTMLInputElement).checked,
      ).toBe(true);
    });
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("ships the backend disclosure verbatim, REST checked by default", async () => {
    const s = await setup();
    for (const copy of Object.values(BACKEND_COPY)) expect(s.getByText(copy)).toBeTruthy();
    const restRadio = s.getByText(BACKEND_COPY.rest).querySelector("input") as HTMLInputElement;
    expect(restRadio.checked).toBe(true);
  });

  it("switching activation persists", async () => {
    const s = await setup();
    const onDemand = s
      .getByText(ACTIVATION_COPY["on-demand"])
      .querySelector("input") as HTMLInputElement;
    fireEvent.change(onDemand, { target: { checked: true } });
    await waitFor(async () => expect((await s.settings.get()).activation).toBe("on-demand"));
  });

  it("default List offers None — always ask plus the cached Lists, and explains the chord", async () => {
    const s = await setup(cachedLists());
    const select = s.getByLabelText("Default List") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      DEFAULT_LIST_NONE,
      "Design Folks (@me)",
    ]);
    fireEvent.change(select, { target: { value: "100:9" } });
    await waitFor(async () =>
      expect((await s.settings.get()).defaultList).toEqual({ ownerUserId: "100", listId: "9" }),
    );
    await waitFor(() => expect(s.getByText(DEFAULT_LIST_HINT)).toBeTruthy());
  });

  it("higher-contrast toggle persists", async () => {
    const s = await setup();
    const box = s.getByText("Higher-contrast buttons").querySelector("input") as HTMLInputElement;
    fireEvent.change(box, { target: { checked: true } });
    await waitFor(async () => expect((await s.settings.get()).highContrast).toBe(true));
  });

  it("names the data it keeps and wipes all of it", async () => {
    const s = await setup({
      ...cachedLists(),
      [`${STORAGE_KEYS.listUsage}:100`]: {
        schema: 1,
        entries: { "9": { count: 2, lastPickedAt: 1 } },
      },
      [STORAGE_KEYS.coach]: { onboarded: true },
    });
    expect(
      s.getByText(
        "Lasso keeps your X session credentials between your browser and X. With Mirror configured, it sends its device key, Owner/List catalog, membership snapshots, and assignment audit events to your Convex deployment.",
      ),
    ).toBeTruthy();
    // Sync also holds the settings + the one global filter — both must go.
    s.sync.data[STORAGE_KEYS.settings] = { backend: "rest" };
    s.sync.data[STORAGE_KEYS.filter] = { enabled: true, criteria: { "kind:video": "hide" } };

    fireEvent.click(s.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => s.getByText("Yes, clear it"))); // confirm step
    await waitFor(() => expect(s.getByText("Cleared")).toBeTruthy());
    expect(s.clearData).toHaveBeenCalledOnce();
  });

  it("renders build defaults after clear without rereading a stale settings cache", async () => {
    const stale = {
      ...DEFAULT_SETTINGS,
      activation: "on-demand" as const,
      convexUrl: "https://stale.convex.cloud",
      convexDeviceKey: "stale-key",
    };
    const get = vi.fn(async () => stale);
    const settings: SettingsStore = {
      get,
      set: async () => stale,
      subscribe: () => () => {},
    };
    const local = memoryArea();
    const sync = memoryArea({ [STORAGE_KEYS.settings]: stale });
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const emit = (snapshot: LassoSettings) => {
      for (const subscribe of subscribers) subscribe(snapshot);
    };
    const remove = sync.remove!;
    sync.remove = async (keys) => {
      await remove(keys);
      emit(DEFAULT_SETTINGS); // chrome.storage's remove event
    };
    settings.subscribe = (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(local)}
        clearData={async () => {
          emit(DEFAULT_SETTINGS);
          return { localCleared: true, syncCleared: true };
        }}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    expect((r.getByLabelText("Convex deployment URL") as HTMLInputElement).value).toBe(
      "https://stale.convex.cloud",
    );
    // OptionsApp is the only settings reader; clear must not ask its stale cache.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const readsBeforeClear = get.mock.calls.length;

    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));
    await waitFor(() => expect(r.getByText("Cleared")).toBeTruthy());

    expect(get).toHaveBeenCalledTimes(readsBeforeClear);
    expect((r.getByLabelText("Convex deployment URL") as HTMLInputElement).value).toBe(
      DEFAULT_SETTINGS.convexUrl ?? "",
    );
    const defaultActivation = r
      .getByText(ACTIVATION_COPY[DEFAULT_SETTINGS.activation])
      .querySelector("input") as HTMLInputElement;
    expect(defaultActivation.checked).toBe(true);
  });

  it("reports a partial clear failure", async () => {
    const local = memoryArea({ [STORAGE_KEYS.coach]: { onboarded: true } });
    local.remove = async () => {
      throw new Error("local storage unavailable");
    };
    const sync = memoryArea();
    const r = render(
      <OptionsApp
        settings={createSettings(sync)}
        coach={createCoach(local)}
        clearData={async () => ({ localCleared: false, syncCleared: true })}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));

    await waitFor(() => expect(r.getByText("Could not clear all data. Try again.")).toBeTruthy());
    expect(r.queryByText("Cleared")).toBeNull();
  });

  it("reports a rejected clear request", async () => {
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        clearData={async () => {
          throw new Error("worker unavailable");
        }}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));

    await waitFor(() => expect(r.getByText("Could not clear all data. Try again.")).toBeTruthy());
    expect(r.queryByText("Cleared")).toBeNull();
  });

  it("rejects a clear superseded by an external settings snapshot", async () => {
    const removal = deferred<{ localCleared: boolean; syncCleared: boolean }>();
    const local = memoryArea({ [STORAGE_KEYS.coach]: { onboarded: true } });
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: async () => DEFAULT_SETTINGS,
      subscribe(callback) {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(local)}
        clearData={() => removal.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));
    for (const subscribe of subscribers) {
      subscribe({ ...DEFAULT_SETTINGS, activation: "on-demand" });
    }
    removal.resolve({ localCleared: true, syncCleared: true });

    await waitFor(() => expect(r.getByText("Could not clear all data. Try again.")).toBeTruthy());
    expect(r.queryByText("Cleared")).toBeNull();
  });

  it("Replay intro restores the welcome card via the coach", async () => {
    const local = memoryArea();
    const sync = memoryArea();
    const coach = createCoach(local);
    await coach.markOnboarded();
    const replaySpy = vi.spyOn(coach, "replayIntro");
    const r = render(<OptionsApp settings={createSettings(sync)} coach={coach} platform="other" />);
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Replay intro"));
    await waitFor(async () => expect(await coach.isOnboarded()).toBe(false));
    expect(replaySpy).toHaveBeenCalled();
  });

  it("resetting the default List back to None clears both default formats", async () => {
    const s = await setup(cachedLists(), undefined, {
      defaultList: { ownerUserId: "100", listId: "9" },
      defaultListId: "9",
    });
    const select = s.getByLabelText("Default List") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(async () => {
      const settings = await s.settings.get();
      expect(settings.defaultList).toBeUndefined();
      expect(settings.defaultListId).toBeUndefined();
    });
  });

  it("switching the connection backend persists", async () => {
    const s = await setup();
    const graphql = s.getByText(BACKEND_COPY.graphql).querySelector("input") as HTMLInputElement;
    fireEvent.change(graphql, { target: { checked: true } });
    await waitFor(async () => expect((await s.settings.get()).backend).toBe("graphql"));
  });

  it("persists the Convex deployment URL and device key, trimming and dropping empties", async () => {
    const s = await setup();
    const url = s.getByLabelText("Convex deployment URL") as HTMLInputElement;
    fireEvent.change(url, { target: { value: "  https://app.convex.cloud  " } });
    await waitFor(async () =>
      expect((await s.settings.get()).convexUrl).toBe("https://app.convex.cloud"),
    );

    const key = s.getByLabelText("Convex device key") as HTMLInputElement;
    fireEvent.change(key, { target: { value: "  secret-key  " } });
    await waitFor(async () => expect((await s.settings.get()).convexDeviceKey).toBe("secret-key"));

    fireEvent.change(url, { target: { value: "   " } });
    await waitFor(async () => expect((await s.settings.get()).convexUrl).toBeUndefined());

    fireEvent.change(key, { target: { value: "" } });
    await waitFor(async () => expect((await s.settings.get()).convexDeviceKey).toBeUndefined());
  });

  it("rejects an invalid Convex URL, announces its error, and keeps storage unchanged", async () => {
    const s = await setup();
    const url = s.getByLabelText("Convex deployment URL") as HTMLInputElement;
    fireEvent.change(url, { target: { value: "https://good.convex.cloud" } });
    await waitFor(async () =>
      expect((await s.settings.get()).convexUrl).toBe("https://good.convex.cloud"),
    );
    fireEvent.change(url, { target: { value: "convex.cloud" } }); // no scheme → would brick boot
    const error = s.getByRole("alert");
    expect(error.textContent).toBe(CONVEX_URL_ERROR);
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(url.getAttribute("aria-describedby")).toBe(error.id);
    await waitFor(async () =>
      expect((await s.settings.get()).convexUrl).toBe("https://good.convex.cloud"),
    ); // the bad value never reached storage
    expect(s.sync.data[STORAGE_KEYS.settings]).toMatchObject({
      convexUrl: "https://good.convex.cloud",
    });
  });

  it("cannot probe an old saved Mirror config while the visible URL is invalid", async () => {
    const probe = vi.fn(async () => {});
    const s = await setup(
      {},
      { probe },
      { convexUrl: "https://good.convex.cloud", convexDeviceKey: "secret" },
    );
    const button = s.getByRole("button", { name: "Test connection" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.change(s.getByLabelText("Convex deployment URL"), {
      target: { value: "invalid" },
    });

    expect(button.disabled).toBe(true);
    // A queued click can outlive its disabled render. The handler still must
    // not probe the old credentials after the visible config became invalid.
    button.removeAttribute("disabled");
    fireEvent.click(button);
    expect(probe).not.toHaveBeenCalled();
    expect(s.queryByText("Connected")).toBeNull();
  });

  it("tests the saved Mirror connection without exposing credentials", async () => {
    const probe = vi.fn(async () => {});
    const s = await setup({}, { probe });
    const button = s.getByRole("button", { name: "Test connection" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(s.getByLabelText("Convex deployment URL"), {
      target: { value: "https://app.convex.cloud" },
    });
    fireEvent.change(s.getByLabelText("Convex device key"), { target: { value: "secret" } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(s.getByText("Connected")).toBeTruthy());
    expect(probe).toHaveBeenCalledWith({
      url: "https://app.convex.cloud",
      deviceKey: "secret",
    });
    expect(s.container.textContent).not.toContain("secret");
  });

  it("reports a failed Mirror connection", async () => {
    const s = await setup({}, { probe: async () => Promise.reject(new Error("unauthorized")) });
    fireEvent.change(s.getByLabelText("Convex deployment URL"), {
      target: { value: "https://app.convex.cloud" },
    });
    fireEvent.change(s.getByLabelText("Convex device key"), { target: { value: "wrong" } });
    await waitFor(() =>
      expect(
        (s.getByRole("button", { name: "Test connection" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(s.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(s.getByText(CONVEX_TEST_ERROR)).toBeTruthy());
  });

  it("does not settle a probe for a superseded Mirror configuration", async () => {
    const probe = deferred<void>();
    const write = deferred<LassoSettings>();
    const configured = {
      ...DEFAULT_SETTINGS,
      convexUrl: "https://first.convex.cloud",
      convexDeviceKey: "first",
    };
    const settings: SettingsStore = {
      get: async () => configured,
      set: () => write.promise,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        mirrorProbe={{ probe: () => probe.promise }}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByRole("button", { name: "Test connection" }));
    fireEvent.change(r.getByLabelText("Convex device key"), { target: { value: "second" } });
    probe.resolve();
    await act(async () => {
      await Promise.resolve();
    });

    expect(r.queryByText("Connected")).toBeNull();
    expect(r.queryByText(CONVEX_TEST_ERROR)).toBeNull();
  });

  it("a nav-rail item scrolls its target section into view", async () => {
    const s = await setup();
    const target = s.container.querySelector("#connection") as HTMLElement;
    const scrollSpy = vi.fn();
    (target as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;
    fireEvent.click(s.getByRole("button", { name: "Connection" }));
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("marks the active rail item and moves the marker on click", async () => {
    const s = await setup();
    expect(s.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(s.getByRole("button", { name: "Connection" }));
    expect(s.getByRole("button", { name: "Connection" }).getAttribute("aria-current")).toBe("true");
    expect(s.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBeNull();
  });

  it("arms a content chip straight from the Timeline filter section", async () => {
    const s = await setup();
    fireEvent.click(
      s.getByRole("button", { name: /^Video\. Current mode: off\. Click to show only\.$/ }),
    );
    expect(s.filter.state.value.criteria["kind:video"]).toBe("only");
  });

  it("toggles the master Timeline filter from Settings", async () => {
    const s = await setup();
    const box = s.getByLabelText("Filter the timeline") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(s.filter.state.value.enabled).toBe(false);
  });

  it("flags when the filter is off so the chips read as inactive", async () => {
    const s = await setup();
    expect(s.queryByText(/filter is off/i)).toBeNull();
    fireEvent.click(s.getByLabelText("Filter the timeline"));
    expect(s.getByText(/filter is off/i)).toBeTruthy();
  });

  it("toggles the language gate from Settings", async () => {
    const s = await setup();
    fireEvent.click(s.getByLabelText("Only my languages"));
    expect(s.filter.state.value.onlyMyLanguages).toBe(true);
  });

  it("toggles the compact-hidden display preference from Settings", async () => {
    const s = await setup();
    const box = s.getByLabelText("Hide filtered posts completely") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(s.filter.state.value.compactHidden).toBe(true);
  });
});

describe("isValidConvexUrl", () => {
  it("accepts only deployment URLs allowed by the manifest", () => {
    expect(isValidConvexUrl("https://app.convex.cloud")).toBe(true);
    expect(isValidConvexUrl("http://localhost:3210")).toBe(false);
    expect(isValidConvexUrl("https://convex.cloud.example.com")).toBe(false);
    expect(isValidConvexUrl("convex.cloud")).toBe(false); // no scheme
    expect(isValidConvexUrl("https://")).toBe(false);
  });
});

describe("OptionsApp — rail scroll-spy + destructive confirm", () => {
  it("cancelling the clear confirm leaves data intact and restores the single button", async () => {
    const s = await setup();
    s.local.data["anything"] = "kept";
    fireEvent.click(s.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => s.getByText("Cancel")));
    await waitFor(() => expect(s.getByText("Clear Lasso data")).toBeTruthy());
    expect(s.queryByText("Yes, clear it")).toBeNull();
    expect(s.local.data["anything"]).toBe("kept");
  });

  it("follows reading position via IntersectionObserver when the platform has one", async () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const observed: string[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          callbacks.push(cb);
        }
        observe(el: Element) {
          observed.push(el.id);
        }
        disconnect = disconnect;
      },
    );
    try {
      const s = await setup();
      await waitFor(() => expect(callbacks.length).toBe(1));
      expect(observed).toContain("sync");

      const io = {} as IntersectionObserver;
      callbacks[0]!(
        [
          { isIntersecting: false, target: { id: "filter" } },
          { isIntersecting: true, target: { id: "sync" } },
        ] as unknown as IntersectionObserverEntry[],
        io,
      );
      await waitFor(() => {
        const active = s.container.querySelector('[aria-current="true"]');
        expect(active?.textContent).toContain("Sync");
      });

      s.unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("treats a rejected catalog port as no cached Lists", async () => {
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        catalogReader={async () => {
          throw new Error("worker unavailable");
        }}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );

    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    const select = r.getByLabelText("Default List") as HTMLSelectElement;
    await waitFor(() =>
      expect([...select.options].map((option) => option.textContent)).toEqual([DEFAULT_LIST_NONE]),
    );
  });
});

describe("OptionsApp — late async work is dropped after unmount or supersession", () => {
  it("drops an initial settings read that resolves after unmount", async () => {
    const read = deferred<LassoSettings>();
    const settings: SettingsStore = {
      get: () => read.promise,
      set: async () => DEFAULT_SETTINGS,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    r.unmount();
    read.resolve(DEFAULT_SETTINGS);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(r.container.querySelector('[role="heading"]')).toBeNull();
  });

  it("drops a Lists catalog read that resolves after unmount", async () => {
    const catalogRead = deferred<Record<string, unknown>>();
    const local = memoryArea();
    const passthrough = local.get;
    local.get = ((keys?: string | string[] | null) =>
      keys == null ? catalogRead.promise : passthrough(keys)) as typeof passthrough;
    const sync = memoryArea();
    const r = render(
      <OptionsApp
        settings={createSettings(sync)}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    r.unmount();
    catalogRead.resolve({});
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("drops a Lists catalog failure after unmount", async () => {
    const catalogRead = deferred<never[]>();
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        catalogReader={() => catalogRead.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    r.unmount();
    catalogRead.reject(new Error("worker unavailable"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("drops a successful settings write that resolves after unmount", async () => {
    const write = deferred<LassoSettings>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => write.promise,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByLabelText("Higher-contrast buttons"));
    r.unmount();
    write.resolve({ ...DEFAULT_SETTINGS, highContrast: true });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("drops a clear whose storage settles after unmount", async () => {
    const removal = deferred<{ localCleared: boolean; syncCleared: boolean }>();
    const sync = memoryArea();
    const r = render(
      <OptionsApp
        settings={createSettings(sync)}
        coach={createCoach(memoryArea())}
        clearData={() => removal.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));
    r.unmount();
    removal.resolve({ localCleared: true, syncCleared: true });
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  });

  it("drops a clear failure after unmount", async () => {
    const removal = deferred<{ localCleared: boolean; syncCleared: boolean }>();
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        clearData={() => removal.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));
    r.unmount();
    removal.reject(new Error("storage unavailable"));
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  });

  it("discards a clear result once a newer clear supersedes it", async () => {
    const removals = [
      deferred<{ localCleared: boolean; syncCleared: boolean }>(),
      deferred<{ localCleared: boolean; syncCleared: boolean }>(),
    ];
    let call = 0;
    const sync = memoryArea();
    const r = render(
      <OptionsApp
        settings={createSettings(sync)}
        coach={createCoach(memoryArea())}
        clearData={() => removals[call++]!.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it"))); // clear #1
    fireEvent.click(r.getByText("Yes, clear it")); // clear #2 supersedes #1
    removals[0]!.resolve({ localCleared: true, syncCleared: true }); // #1 settles, but pendingClear now points at #2
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(r.queryByText("Cleared")).toBeNull(); // the superseded #1 result never lands

    removals[1]!.resolve({ localCleared: true, syncCleared: true }); // #2 is authority and completes the clear
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(r.getByText("Cleared")).toBeTruthy();
  });

  it("swallows a failed Replay intro without a crash or acknowledgement", async () => {
    const coach = createCoach(memoryArea());
    vi.spyOn(coach, "replayIntro").mockRejectedValue(new Error("coach storage unavailable"));
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={coach}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Replay intro"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(r.queryByText("On your next visit to x.com")).toBeNull();
  });
});

describe("OptionsApp — Sync saved acknowledgement", () => {
  it("acknowledges a saved Mirror edit that rotates its internal identity", async () => {
    const s = await setup(
      {},
      { probe: async () => {} },
      {
        convexUrl: "https://first.convex.cloud",
        convexDeviceKey: "first-key",
        mirrorConfigId: "mirror-first",
      },
    );
    fireEvent.click(s.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(s.getByText("Connected")).toBeTruthy());

    fireEvent.change(s.getByLabelText("Convex device key"), { target: { value: "second-key" } });

    await waitFor(() => expect(s.getByText("Saved")).toBeTruthy());
    expect(s.queryByText("Connected")).toBeNull();
    expect((s.sync.data[STORAGE_KEYS.settings] as LassoSettings).mirrorConfigId).not.toBe(
      "mirror-first",
    );
  });

  it("shows Saved when P1 fails and P2's local Mirror snapshot differs", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const initial = {
      ...DEFAULT_SETTINGS,
      convexUrl: "https://first.convex.cloud",
      convexDeviceKey: "first-key",
      mirrorConfigId: "mirror-first",
    };
    const accepted = {
      ...initial,
      convexDeviceKey: "second-key",
      mirrorConfigId: "mirror-second",
    };
    const writes = [first, second];
    let publish: Parameters<SettingsStore["subscribe"]>[0] | undefined;
    const settings: SettingsStore = {
      get: async () => initial,
      set: () => writes.shift()!.promise,
      subscribe: (listener) => {
        publish = listener;
        return () => {};
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        mirrorProbe={{ probe: async () => {} }}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(r.getByText("Connected")).toBeTruthy());

    fireEvent.change(r.getByLabelText("Convex deployment URL"), {
      target: { value: "https://second.convex.cloud" },
    });
    fireEvent.change(r.getByLabelText("Convex device key"), { target: { value: "second-key" } });
    first.reject(new Error("storage unavailable"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => publish?.(accepted, "local"));

    await waitFor(() => expect(r.getByText("Saved")).toBeTruthy());
    expect(r.queryByText("Connected")).toBeNull();
    expect((r.getByLabelText("Convex deployment URL") as HTMLInputElement).value).toBe(
      initial.convexUrl,
    );
    expect((r.getByLabelText("Convex device key") as HTMLInputElement).value).toBe(
      accepted.convexDeviceKey,
    );
    second.resolve(accepted);
  });

  it("shows a transient Saved tick after persisting a Sync field", async () => {
    const s = await setup();
    const url = s.getByLabelText("Convex deployment URL") as HTMLInputElement;
    vi.useFakeTimers();
    try {
      await act(async () => {
        url.value = "https://silent-crab-355.convex.cloud";
        fireEvent.change(url);
        // settings.set → syncedStore write → .then(setSyncSaved): drain the
        // microtask chain by hand — waitFor can't run under fake timers.
        for (let i = 0; i < 8; i++) await Promise.resolve();
      });
      expect(s.getByText("Saved")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(s.queryByText("Saved")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OptionsApp — epoch fencing and supersession edges", () => {
  it("keeps the newest surface and general save when the older save settles last", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.change(r.getByLabelText("Command palette"), { target: { checked: true } });
    fireEvent.click(r.getByLabelText("Higher-contrast buttons"));

    const newest = {
      ...DEFAULT_SETTINGS,
      highContrast: true,
      surfaces: { pill: true, palette: true },
    };
    second.resolve(newest);
    await waitFor(() => {
      expect((r.getByLabelText("Command palette") as HTMLInputElement).checked).toBe(true);
      expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(true);
    });

    first.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: true, palette: true } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((r.getByLabelText("Command palette") as HTMLInputElement).checked).toBe(true);
    expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(true);
  });

  it("rolls a failed surface save back through OptionsApp authority", async () => {
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: async () => Promise.reject(new Error("storage unavailable")),
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.change(r.getByLabelText("Command palette"), { target: { checked: true } });

    await waitFor(() =>
      expect(r.getByRole("alert").textContent).toBe("Could not save settings. Try again."),
    );
    expect((r.getByLabelText("Command palette") as HTMLInputElement).checked).toBe(false);
  });

  it("keeps clear authority when an earlier surface save resolves late", async () => {
    const write = deferred<LassoSettings>();
    const clear = deferred<{ localCleared: boolean; syncCleared: boolean }>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => write.promise,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        clearData={() => clear.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.change(r.getByLabelText("Command palette"), { target: { checked: true } });
    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it")));
    clear.resolve({ localCleared: true, syncCleared: true });
    await waitFor(() => expect(r.getByText("Cleared")).toBeTruthy());

    write.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: true, palette: true } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((r.getByLabelText("Command palette") as HTMLInputElement).checked).toBe(false);
  });

  it("drops a resolved write's authority once a newer external change fenced its epoch", async () => {
    const write = deferred<LassoSettings>();
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => write.promise,
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByLabelText("Higher-contrast buttons")); // W1, captured at epoch 0
    // An unrelated external change lands first and bumps the epoch past W1.
    for (const subscribe of subscribers) subscribe({ ...DEFAULT_SETTINGS, backend: "graphql" });
    // W1's own pre-promise echo arrives, but its epoch is now stale and is dropped.
    for (const subscribe of subscribers) subscribe({ ...DEFAULT_SETTINGS, highContrast: true });

    await waitFor(() =>
      expect(
        (r.getByText(BACKEND_COPY.graphql).querySelector("input") as HTMLInputElement).checked,
      ).toBe(true),
    );
    // The stale echo never re-seized authority, so its highContrast is not shown.
    expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(false);
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("ignores a failed initial read that a newer subscription snapshot already superseded", async () => {
    const read = deferred<LassoSettings>();
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const settings: SettingsStore = {
      get: () => read.promise,
      set: async () => DEFAULT_SETTINGS,
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(subscribers.size).toBe(1));
    // A live subscription snapshot advances the read revision and paints the form...
    for (const subscribe of subscribers)
      subscribe({ ...DEFAULT_SETTINGS, activation: "on-demand" });
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    // ...so when the original get() finally rejects it is stale and raises no load error.
    read.reject(new Error("storage unavailable"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(r.queryByText("Could not load settings.")).toBeNull();
    expect(r.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("rebuilds a queued write from confirmed authority when an older pending write is fenced", async () => {
    const subscribers = new Set<(snapshot: LassoSettings) => void>();
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: () => new Promise<LassoSettings>(() => {}), // both writes stay pending
      subscribe: (cb) => {
        subscribers.add(cb);
        return () => subscribers.delete(cb);
      },
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByLabelText("Higher-contrast buttons")); // W1 at epoch 0
    // External change bumps the epoch; W1 now belongs to a fenced, older epoch.
    for (const subscribe of subscribers) subscribe({ ...DEFAULT_SETTINGS, backend: "graphql" });
    // A second write at the new epoch must skip the fenced W1 and build on the external authority.
    fireEvent.change(
      r.getByText(ACTIVATION_COPY["on-demand"]).querySelector("input") as HTMLInputElement,
      { target: { checked: true } },
    );

    await waitFor(() =>
      expect(
        (r.getByText(BACKEND_COPY.graphql).querySelector("input") as HTMLInputElement).checked,
      ).toBe(true),
    );
    expect(
      (r.getByText(ACTIVATION_COPY["on-demand"]).querySelector("input") as HTMLInputElement)
        .checked,
    ).toBe(true);
    // W1's highContrast was NOT chained into the queued write — the fenced write was skipped.
    expect((r.getByLabelText("Higher-contrast buttons") as HTMLInputElement).checked).toBe(false);
  });

  it("does not report a failed probe once its Mirror configuration was superseded", async () => {
    const probe = deferred<void>();
    const write = deferred<LassoSettings>();
    const configured = {
      ...DEFAULT_SETTINGS,
      convexUrl: "https://first.convex.cloud",
      convexDeviceKey: "first",
    };
    const settings: SettingsStore = {
      get: async () => configured,
      set: () => write.promise,
      subscribe: () => () => {},
    };
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        mirrorProbe={{ probe: () => probe.promise }}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByRole("button", { name: "Test connection" }));
    // The device key changes while the probe is in flight, so the result no longer applies.
    fireEvent.change(r.getByLabelText("Convex device key"), { target: { value: "second" } });
    probe.reject(new Error("unauthorized"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(r.queryByText(CONVEX_TEST_ERROR)).toBeNull();
    expect(r.queryByText("Connected")).toBeNull();
  });

  it("keeps a newer clear's ownership when a superseded clear reports a partial failure", async () => {
    const removals = [
      deferred<{ localCleared: boolean; syncCleared: boolean }>(),
      deferred<{ localCleared: boolean; syncCleared: boolean }>(),
    ];
    let call = 0;
    const local = memoryArea({ [STORAGE_KEYS.coach]: { onboarded: true } });
    const sync = memoryArea();
    const r = render(
      <OptionsApp
        settings={createSettings(sync)}
        coach={createCoach(local)}
        clearData={() => removals[call++]!.promise}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    fireEvent.click(r.getByText("Clear Lasso data"));
    fireEvent.click(await waitFor(() => r.getByText("Yes, clear it"))); // clear #1
    fireEvent.click(r.getByText("Yes, clear it")); // clear #2 supersedes #1

    removals[0]!.reject(new Error("local storage unavailable")); // #1 settles as a partial failure
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    // The superseded #1 surfaces the failure but must not seize pendingClear back from #2.
    expect(r.getByText("Could not clear all data. Try again.")).toBeTruthy();
    expect(r.queryByText("Cleared")).toBeNull();

    removals[1]!.resolve({ localCleared: true, syncCleared: true }); // #2 still owns pendingClear and completes the clear
    await act(async () => {
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(r.getByText("Cleared")).toBeTruthy();
  });

  it("drops a Replay intro acknowledgement when the page unmounts first", async () => {
    const replay = deferred<void>();
    const coach = createCoach(memoryArea());
    vi.spyOn(coach, "replayIntro").mockReturnValue(replay.promise);
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={coach}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Replay intro"));
    r.unmount();
    replay.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(r.queryByText("On your next visit to x.com")).toBeNull();
  });
});

describe("OptionsApp — nav-rail / section pairing (ticket #72)", () => {
  it("renders a section element for every rail entry, by direct enumeration", async () => {
    // Not the scroll-spy effect: that returns early when IntersectionObserver
    // is undefined under happy-dom, so it would prove nothing about a rail
    // entry missing its section. This walks RAIL itself and queries the DOM.
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        foldersClient={fakeFoldersClient()}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());

    for (const { target } of RAIL) {
      expect(r.container.querySelector(`#${target}`), target).toBeTruthy();
    }
    expect(r.getByRole("button", { name: "Folders" })).toBeTruthy();
  });
});

describe("OptionsApp — the Folders section carries no X account (ticket #72)", () => {
  const FOLDER: Folder = {
    folderId: "fld_00000000000000000001",
    name: "Research",
    sortIndex: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };

  async function render_(catalogReader: () => Promise<never[]> | Promise<unknown[]>) {
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        catalogReader={catalogReader as () => Promise<never[]>}
        foldersClient={fakeFoldersClient([FOLDER])}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    // Scoped to this render's own container: `render()` queries search the
    // whole document by default, and this suite deliberately keeps several
    // renders mounted at once to compare their output.
    await waitFor(() =>
      expect(r.container.querySelector("#folders")?.textContent).toContain("Research"),
    );
    return r;
  }

  it("renders the same Folders section for one Owner's List catalog, none, and a different Owner", async () => {
    const withOwner = await render_(async () => [
      { owner: { userId: "1", screenName: "jack" }, lists: [{ id: "9", name: "Tech" }] },
    ]);
    const withOwnerHtml = sectionHtml(withOwner, "folders");

    const noCatalog = await render_(async () => []);
    expect(sectionHtml(noCatalog, "folders")).toBe(withOwnerHtml);

    const differentOwner = await render_(async () => [
      { owner: { userId: "2", screenName: "moss" }, lists: [{ id: "5", name: "Design" }] },
    ]);
    expect(sectionHtml(differentOwner, "folders")).toBe(withOwnerHtml);

    // The neighbouring Default List section, by contrast, DOES vary with the
    // catalog — the point being tested is Folders' independence, not that
    // nothing on the page ever changes.
    expect(sectionHtml(withOwner, "lists") === sectionHtml(noCatalog, "lists")).toBe(false);
  });

  it("is usable with no X session and no List catalog read, and shows no caveat of its own", async () => {
    const r = await render_(() => Promise.reject(new Error("no x.com tab")));
    expect(r.getByText("Research")).toBeTruthy();
    // The Default List section's caveat is about Lists, not Folders — the
    // Folders section must not surface a lookalike of its own.
    const folders = r.container.querySelector("#folders")!;
    expect(folders.textContent).not.toMatch(/open x\.com/i);
  });

  it("patches the default Folder through the same settings authority as every other control", async () => {
    const sync = memoryArea();
    sync.data[STORAGE_KEYS.settings] = { convexUrl: undefined, convexDeviceKey: undefined };
    const settings = createSettings(sync);
    const r = render(
      <OptionsApp
        settings={settings}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        foldersClient={fakeFoldersClient([FOLDER])}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    await waitFor(() => expect(r.getByLabelText("Default Folder")).toBeTruthy());

    fireEvent.change(r.getByLabelText("Default Folder"), { target: { value: FOLDER.folderId } });
    await waitFor(async () => expect((await settings.get()).defaultFolderId).toBe(FOLDER.folderId));
  });
});

describe("OptionsApp — Privacy names everything Clear destroys (ticket #72)", () => {
  it("pins the confirmation sentence naming Folders and Saved Posts", async () => {
    const r = render(
      <OptionsApp
        settings={createSettings(memoryArea())}
        coach={createCoach(memoryArea())}
        platform="other"
        filter={createFilterStore({ storage: memoryArea() })}
        foldersClient={fakeFoldersClient()}
      />,
    );
    await waitFor(() => expect(r.container.querySelector("[data-loading]")).toBeNull());
    fireEvent.click(r.getByText("Clear Lasso data"));
    expect(await r.findByText(CLEAR_CONFIRMATION)).toBeTruthy();
  });
});
