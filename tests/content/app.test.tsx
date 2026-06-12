import { signal } from "@preact/signals-core";
import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { App, OverlayBinding } from "@/content/app";
import { createSelectionStore } from "@/core/selection-store";
import type { XList, XListApi } from "@/core/x-client/types";

const author = { screenName: "jack", displayName: "Jack" };
const lists: XList[] = [
  { id: "1", name: "Research" },
  { id: "2", name: "Friends" },
];

function backend(): XListApi {
  return {
    getLists: vi.fn(async () => lists),
    resolveUserId: vi.fn(async () => null),
    addMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
  };
}

describe("OverlayBinding", () => {
  it("re-renders from the selection signal and toggles the author", async () => {
    const selection = createSelectionStore();
    const { getByRole } = render(<OverlayBinding selection={selection} author={author} />);
    const button = getByRole("button");

    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(selection.isSelected("jack")).toBe(true);
  });
});

describe("App", () => {
  it("opens ranked lists, assigns selected authors, records usage, clears, and hides the toast", async () => {
    const selection = createSelectionStore();
    selection.add(author);
    const timeoutCallbacks: Array<() => void> = [];
    const realSetTimeout = window.setTimeout.bind(window);
    const timeoutImpl = ((cb: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 4000 && typeof cb === "function") {
        timeoutCallbacks.push(() => cb());
        return realSetTimeout(() => {}, 0);
      }
      return realSetTimeout(cb, ms, ...args);
    }) as typeof window.setTimeout;
    const timeout = vi.spyOn(window, "setTimeout").mockImplementation(timeoutImpl);
    const api = backend();
    const listCache = { lists: vi.fn(async () => lists), search: vi.fn(async () => lists) };
    const listUsage = {
      record: vi.fn(async () => {}),
      rank: vi.fn(async (fresh: XList[]) => fresh.toReversed()),
    };

    const { getByText, queryByText } = render(
      <App selection={selection} backend={api} listCache={listCache} listUsage={listUsage} />,
    );

    fireEvent.click(getByText("Add to list"));
    await waitFor(() => expect(getByText("Friends")).toBeTruthy());
    fireEvent.mouseDown(getByText("Friends"));

    await waitFor(() => expect(api.addMember).toHaveBeenCalledWith(lists[1], author));
    expect(listCache.lists).toHaveBeenCalledWith({ force: true });
    expect(listUsage.record).toHaveBeenCalledWith("2");
    expect(selection.count.value).toBe(0);
    await waitFor(() => expect(getByText("Added 1")).toBeTruthy());

    act(() => timeoutCallbacks[0]?.());
    await waitFor(() => expect(queryByText("Added 1")).toBeNull());
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 4000);
    timeout.mockRestore();
  });

  it("opens from the keyboard tick without list usage ranking", async () => {
    const selection = createSelectionStore();
    const tick = signal(0);
    const listCache = { lists: vi.fn(async () => lists), search: vi.fn(async () => lists) };

    const { getByText } = render(
      <App selection={selection} backend={backend()} listCache={listCache} openPickerTick={tick} />,
    );

    tick.value += 1;
    await waitFor(() => expect(getByText("Research")).toBeTruthy());
    expect(listCache.lists).toHaveBeenCalledWith({ force: true });
  });

  it("shows an empty picker when list loading fails and cancels it", async () => {
    const selection = createSelectionStore();
    selection.add(author);
    const listCache = {
      lists: vi.fn(async () => {
        throw new Error("logged out");
      }),
      search: vi.fn(async () => []),
    };

    const { getByText, getByLabelText, queryByRole } = render(
      <App selection={selection} backend={backend()} listCache={listCache} />,
    );

    fireEvent.click(getByText("Add to list"));
    await waitFor(() => expect(getByText("No matching lists")).toBeTruthy());
    fireEvent.keyDown(getByLabelText("Filter your lists"), { key: "Escape" });
    expect(queryByRole("dialog")).toBeNull();
  });

  it("clears the selection from the action bar", () => {
    const selection = createSelectionStore();
    selection.add(author);
    const { getByLabelText, queryByText } = render(
      <App
        selection={selection}
        backend={backend()}
        listCache={{ lists: vi.fn(), search: vi.fn() }}
      />,
    );

    fireEvent.click(getByLabelText("Clear selection"));
    expect(selection.count.value).toBe(0);
    expect(queryByText("1 selected")).toBeNull();
  });
});
