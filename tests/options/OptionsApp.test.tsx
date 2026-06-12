import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createCoach } from "@/core/coach";
import { createSettings, type StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import {
  ACTIVATION_COPY,
  BACKEND_COPY,
  DEFAULT_LIST_HINT,
  DEFAULT_LIST_NONE,
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
  const r = render(
    <OptionsApp settings={settings} coach={coach} local={local} sync={sync} platform="other" />,
  );
  await waitFor(() => expect(r.container.querySelector("main")).toBeTruthy());
  return { ...r, local, sync, settings, coach };
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
    fireEvent.click(s.getByText("Clear Lasso data"));
    await waitFor(() => expect(s.getByText("Cleared")).toBeTruthy());
    expect(Object.keys(s.local.data)).toEqual([]);
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
});
