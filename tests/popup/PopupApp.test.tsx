import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import type { StorageLike } from "@/core/settings";
import { PopupApp } from "@/popup/PopupApp";

/** In-memory storage.sync double: records the last persisted blob. */
function fakeStorage(): StorageLike & { items: Record<string, unknown> } {
  const items: Record<string, unknown> = {};
  return {
    items,
    async get(keys) {
      if (typeof keys === "string") return { [keys]: items[keys] };
      return { ...items };
    },
    async set(next) {
      Object.assign(items, next);
    },
  };
}

const KEY = "lasso:filter";

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
    const wake = vi.fn(async () => {});
    const r = render(
      <PopupApp queryState={async () => "asleep"} wake={wake} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Asleep — click to wake")).toBeTruthy());
    fireEvent.click(r.getByText("Asleep — click to wake"));
    expect(wake).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
  });

  it("off-x tabs show the Off X badge and the open-x.com hint", async () => {
    const r = render(
      <PopupApp queryState={async () => "off-x"} wake={async () => {}} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Off X")).toBeTruthy());
    expect(r.getByText("Open x.com to use Lasso")).toBeTruthy();
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
    const box = (await waitFor(() => r.getByLabelText("Timeline filter"))) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(filter.state.value.enabled).toBe(false);
    await waitFor(() => {
      const persisted = storage.items[KEY] as { enabled: boolean } | undefined;
      expect(persisted?.enabled).toBe(false);
    });
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
    const box = (await waitFor(() =>
      r.getByLabelText("Hide filtered posts completely"),
    )) as HTMLInputElement;
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

  it("applies a saved preset on click and labels singular counts", async () => {
    const filter = createFilterStore({ storage: fakeStorage() });
    filter.setOnlyMyLanguages(true); // armed = 1 → "filter on"
    filter.savePreset("Reading"); // presetCount = 1 → "preset"
    const apply = vi.spyOn(filter, "applyPreset");
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={filter}
      />,
    );
    await waitFor(() => expect(r.getByText("filter on")).toBeTruthy());
    expect(r.getByText("preset")).toBeTruthy();
    fireEvent.click(r.getByRole("button", { name: "Reading" }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("labels plural counts by default (0 filters, 0 presets)", async () => {
    const r = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );
    await waitFor(() => expect(r.getByText("filters on")).toBeTruthy());
    expect(r.getByText("presets")).toBeTruthy();
  });
});

describe("Mirror status row — instant sync observability (ADR-0009)", () => {
  const base = {
    queryState: async () => "active" as const,
    wake: async () => {},
    openOptions: () => {},
  };

  it("shows the synced age when the last Mirror write succeeded", async () => {
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        mirrorStatus={async () => ({ ok: true, at: Date.UTC(2026, 6, 2, 11, 57) })}
        now={() => Date.UTC(2026, 6, 2, 12, 0)}
      />,
    );
    await waitFor(() => expect(r.getByText("Mirror synced 3m ago")).toBeTruthy());
  });

  it("falls back to the wall clock when no now() is injected", async () => {
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        mirrorStatus={async () => ({ ok: true, at: Date.now() })}
      />,
    );
    await waitFor(() => expect(r.getByText("Mirror synced just now")).toBeTruthy());
  });

  it("flags a failing Mirror so a CSP-blocked/broken deployment is visible instantly", async () => {
    const r = render(
      <PopupApp
        {...base}
        filter={createFilterStore({ storage: fakeStorage() })}
        mirrorStatus={async () => ({ ok: false, at: 1 })}
      />,
    );
    await waitFor(() => expect(r.getByText("Mirror failing — check Convex settings")).toBeTruthy());
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
});
