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

describe("PopupApp — hosting the shared filter panel (task 013)", () => {
  it("renders the FilterPanel chips inside the popup", async () => {
    const storage = fakeStorage();
    const filter = createFilterStore({ storage });

    const { getByLabelText } = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        platform="other"
        filter={filter}
      />,
    );

    await waitFor(() => expect(getByLabelText("Video")).toBeTruthy());
    expect(getByLabelText("Photo")).toBeTruthy();
    expect(getByLabelText("Text")).toBeTruthy();
  });

  it("clicking the Video chip cycles kind:video and persists to storage.sync", async () => {
    const storage = fakeStorage();
    const filter = createFilterStore({ storage });
    const cycle = vi.spyOn(filter, "cycle");

    const { getByLabelText } = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        platform="other"
        filter={filter}
      />,
    );

    await waitFor(() => expect(getByLabelText("Video")).toBeTruthy());
    fireEvent.click(getByLabelText("Video"));

    expect(cycle).toHaveBeenCalledWith("kind:video");
    await waitFor(() => {
      const persisted = storage.items[KEY] as { criteria: Record<string, string> } | undefined;
      expect(persisted?.criteria["kind:video"]).toBe("only");
    });
  });

  it("links to the Options page for deep config", async () => {
    const openOptions = vi.fn();
    const { getByText } = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={openOptions}
        platform="other"
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );

    await waitFor(() => expect(getByText("All settings →")).toBeTruthy());
    fireEvent.click(getByText("All settings →"));
    expect(openOptions).toHaveBeenCalledTimes(1);
  });

  it("renders the panel without a live hidden-count / show-all line (off-page mode)", async () => {
    const { queryByText, getByLabelText } = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        platform="other"
        filter={createFilterStore({ storage: fakeStorage() })}
      />,
    );

    await waitFor(() => expect(getByLabelText("Video")).toBeTruthy());
    expect(queryByText("show all")).toBeNull();
    expect(queryByText(/\bhidden\b/)).toBeNull();
  });
});
