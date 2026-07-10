import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createCoach } from "@/core/coach";
import { createFilterStore } from "@/core/filter-store";
import { createSettings, type StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import {
  ACTIVATION_COPY,
  BACKEND_COPY,
  CONVEX_URL_ERROR,
  DEFAULT_LIST_HINT,
  DEFAULT_LIST_NONE,
  isValidConvexUrl,
  OptionsApp,
} from "@/options/OptionsApp";

function memoryArea(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get() {
      return { ...data };
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

async function setup(seedLocal: Record<string, unknown> = {}) {
  const local = memoryArea();
  const sync = memoryArea();
  Object.assign(local.data, seedLocal);
  const settings = createSettings(sync);
  const coach = createCoach(local);
  const filter = createFilterStore({ storage: memoryArea() });
  const r = render(
    <OptionsApp
      settings={settings}
      coach={coach}
      local={local}
      sync={sync}
      platform="other"
      filter={filter}
    />,
  );
  await waitFor(() => expect(r.container.querySelector("main")).toBeTruthy());
  return { ...r, local, sync, settings, coach, filter };
}

describe("OptionsApp — story beat 9", () => {
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
    const s = await setup({
      [STORAGE_KEYS.lists]: [{ id: "9", name: "Design Folks" }],
    });
    const select = s.getByLabelText("Default List") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      DEFAULT_LIST_NONE,
      "Design Folks",
    ]);
    fireEvent.change(select, { target: { value: "9" } });
    await waitFor(async () => expect((await s.settings.get()).defaultListId).toBe("9"));
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
      [STORAGE_KEYS.lists]: [{ id: "9", name: "Design Folks" }],
      [STORAGE_KEYS.listUsage]: { "9": { n: 2, t: 1 } },
      [STORAGE_KEYS.coach]: { onboarded: true },
    });
    expect(
      s.getByText(
        "Lasso has no servers. Your X session, your Lists, and your usage stats never leave this browser.",
      ),
    ).toBeTruthy();
    // Sync also holds the settings + the one global filter — both must go.
    s.sync.data[STORAGE_KEYS.settings] = { backend: "rest" };
    s.sync.data[STORAGE_KEYS.filter] = { enabled: true, criteria: { "kind:video": "hide" } };

    fireEvent.click(s.getByText("Clear Lasso data"));
    await waitFor(() => expect(s.getByText("Cleared")).toBeTruthy());
    expect(Object.keys(s.local.data)).toEqual([]);
    expect(STORAGE_KEYS.settings in s.sync.data).toBe(false);
    expect(STORAGE_KEYS.filter in s.sync.data).toBe(false);
  });

  it("Replay intro restores the welcome card via the coach", async () => {
    const local = memoryArea();
    const sync = memoryArea();
    const coach = createCoach(local);
    await coach.markOnboarded();
    const replaySpy = vi.spyOn(coach, "replayIntro");
    const r = render(
      <OptionsApp
        settings={createSettings(sync)}
        coach={coach}
        local={local}
        sync={sync}
        platform="other"
      />,
    );
    await waitFor(() => expect(r.container.querySelector("main")).toBeTruthy());
    fireEvent.click(r.getByText("Replay intro"));
    await waitFor(async () => expect(await coach.isOnboarded()).toBe(false));
    expect(replaySpy).toHaveBeenCalled();
  });

  it("resetting the default List back to None clears defaultListId", async () => {
    const s = await setup({
      [STORAGE_KEYS.lists]: [{ id: "9", name: "Design Folks" }],
    });
    const select = s.getByLabelText("Default List") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "9" } });
    await waitFor(async () => expect((await s.settings.get()).defaultListId).toBe("9"));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(async () => expect((await s.settings.get()).defaultListId).toBeUndefined());
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

  it("rejects a scheme-less Convex URL: shows an error and keeps the last valid value", async () => {
    const s = await setup();
    const url = s.getByLabelText("Convex deployment URL") as HTMLInputElement;
    fireEvent.change(url, { target: { value: "https://good.convex.cloud" } });
    await waitFor(async () =>
      expect((await s.settings.get()).convexUrl).toBe("https://good.convex.cloud"),
    );
    fireEvent.change(url, { target: { value: "convex.cloud" } }); // no scheme → would brick boot
    expect(s.getByText(CONVEX_URL_ERROR)).toBeTruthy();
    await waitFor(async () =>
      expect((await s.settings.get()).convexUrl).toBe("https://good.convex.cloud"),
    ); // the bad value never reached storage
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
    fireEvent.click(s.getByRole("button", { name: /^Video$/ }));
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
  it("accepts full http(s) URLs and rejects scheme-less or unparseable ones", () => {
    expect(isValidConvexUrl("https://app.convex.cloud")).toBe(true);
    expect(isValidConvexUrl("http://localhost:3210")).toBe(true);
    expect(isValidConvexUrl("convex.cloud")).toBe(false); // no scheme
    expect(isValidConvexUrl("https://")).toBe(false); // scheme present but unparseable (catch)
  });
});
