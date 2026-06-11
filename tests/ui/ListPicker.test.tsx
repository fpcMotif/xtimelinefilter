import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { ListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import { XApiError, type XList } from "@/core/x-client/types";
import { ListPicker } from "@/ui/ListPicker";

const LISTS: XList[] = [
  { id: "1", name: "Research", memberCount: 1204 },
  { id: "2", name: "Friends", isPrivate: true },
  { id: "3", name: "Founders", memberCount: 1 },
];

function cacheOf(impl: () => Promise<XList[]>): ListCache {
  return {
    lists: () => impl(),
    search: async () => [],
  };
}

async function setup(opts: {
  lists?: () => Promise<XList[]>;
  recentIds?: () => Promise<string[]>;
  memberships?: () => Promise<string[]>;
  header?: string;
  selectedCount?: number;
}) {
  const picker = createPickerController({
    cache: cacheOf(opts.lists ?? (async () => LISTS)),
    ...(opts.recentIds ? { recentIds: opts.recentIds } : {}),
    ...(opts.memberships ? { memberships: opts.memberships } : {}),
  });
  await picker.open([{ screenName: "jane" }]);
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const onCreateList = vi.fn();
  const r = render(
    <ListPicker
      picker={picker}
      header={opts.header ?? "Add @jane to a List"}
      selectedCount={opts.selectedCount ?? 1}
      onPick={onPick}
      onCancel={onCancel}
      onCreateList={onCreateList}
    />,
  );
  const input = () => r.container.querySelector("input") as HTMLInputElement;
  const options = () =>
    [...r.container.querySelectorAll('[role="option"]')].map(
      (e) => e.querySelector("span")?.textContent,
    );
  return { ...r, picker, input, options, onPick, onCancel, onCreateList };
}

describe("ListPicker — ready state anatomy (story beat 4)", () => {
  it("renders the people-counting header, Search Lists placeholder, and footer legend", async () => {
    const s = await setup({ header: "Add 3 people to a List", selectedCount: 3 });
    expect(s.getByText("Add 3 people to a List")).toBeTruthy();
    expect(s.input().placeholder).toBe("Search Lists");
    expect(s.getByText("↑↓ Navigate · Enter Add · Esc Dismiss · 3 selected")).toBeTruthy();
  });

  it("shows member counts and lock icons on private Lists", async () => {
    const s = await setup({});
    expect(s.getByText("1,204 members")).toBeTruthy();
    expect(s.getByText("1 member")).toBeTruthy();
    expect(s.getByLabelText("Private")).toBeTruthy();
  });

  it("groups recently used Lists under Recent / All Lists", async () => {
    const s = await setup({ recentIds: async () => ["3"] });
    expect(s.getByText("Recent")).toBeTruthy();
    expect(s.getByText("All Lists")).toBeTruthy();
    expect(s.options()).toEqual(["Founders", "Research", "Friends"]);
  });

  it("marks Lists that already contain the person", async () => {
    const s = await setup({ memberships: async () => ["2"] });
    await waitFor(() => expect(s.getByLabelText("Already in")).toBeTruthy());
  });

  it("filters fuzzily, navigates with arrows, picks on Enter", async () => {
    const s = await setup({});
    fireEvent.input(s.input(), { target: { value: "f" } });
    await waitFor(() => expect(s.options()).toEqual(["Founders", "Friends"]));
    fireEvent.keyDown(s.input(), { key: "ArrowDown" });
    fireEvent.keyDown(s.input(), { key: "Enter" });
    await waitFor(() =>
      expect(s.onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "Friends" })),
    );
  });

  it("Escape dismisses", async () => {
    const s = await setup({});
    fireEvent.keyDown(s.input(), { key: "Escape" });
    expect(s.onCancel).toHaveBeenCalled();
  });
});

describe("ListPicker — designed failure beats (story beat 8)", () => {
  it("no-match offers Clear search and a creation path, never a dead end", async () => {
    const s = await setup({});
    fireEvent.input(s.input(), { target: { value: "xyz" } });
    await waitFor(() => expect(s.getByText('No Lists match "xyz"')).toBeTruthy());
    expect(s.getByText('Create "xyz" on X')).toBeTruthy();
    fireEvent.click(s.getByText("Clear search"));
    await waitFor(() => expect(s.options()).toHaveLength(3));
  });

  it("true empty: explains Lists and offers Create a List on X", async () => {
    const s = await setup({ lists: async () => [] });
    expect(s.getByText("You don't have any Lists yet")).toBeTruthy();
    expect(s.getByText("Lists let you group people on X")).toBeTruthy();
    fireEvent.click(s.getByText("Create a List on X"));
    expect(s.onCreateList).toHaveBeenCalledTimes(1);
  });

  it("logged out: names the cause and offers Retry", async () => {
    const s = await setup({
      lists: async () => {
        throw new XApiError("auth", "401");
      },
    });
    expect(s.getByText("Couldn't load your Lists")).toBeTruthy();
    expect(s.getByText("You may be logged out of X")).toBeTruthy();
    expect(s.getByText("Retry")).toBeTruthy();
  });

  it("rate-limited fetch names the rate limit", async () => {
    const s = await setup({
      lists: async () => {
        throw new XApiError("rate-limited", "429");
      },
    });
    expect(s.getByText("X rate limited Lasso — try again in a few minutes")).toBeTruthy();
  });

  it("pressing r retries from the keyboard", async () => {
    let fail = true;
    const s = await setup({
      lists: async () => {
        if (fail) throw new XApiError("auth", "401");
        return LISTS;
      },
    });
    fail = false;
    fireEvent.keyDown(s.getByText("Retry"), { key: "r" });
    await waitFor(() => expect(s.picker.status.value).toBe("ready"));
  });

  it("loading shows skeleton rows, not a lie", async () => {
    const picker = createPickerController({
      cache: cacheOf(() => new Promise<XList[]>(() => {})), // never resolves
    });
    void picker.open([{ screenName: "jane" }]);
    const { container } = render(
      <ListPicker
        picker={picker}
        header="Add @jane to a List"
        selectedCount={1}
        onPick={() => {}}
        onCancel={() => {}}
        onCreateList={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-loading-row]").length).toBe(3);
  });
});
