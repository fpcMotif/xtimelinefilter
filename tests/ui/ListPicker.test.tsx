import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { ListCache } from "@/core/list-cache";
import type { MembershipStore, Owner } from "@/core/membership-store/types";
import { createPickerController } from "@/core/picker-controller";
import type { TweetAuthor } from "@/core/selection-store";
import { XApiError, type XList } from "@/core/x-client/types";
import { freshnessLabel, ListPicker } from "@/ui/ListPicker";

const OWNER: Owner = { userId: "100", screenName: "me" };
const FOREIGN: Owner = { userId: "200", screenName: "alt" };
const LISTS: XList[] = [
  { id: "1", name: "Research", memberCount: 1204 },
  { id: "2", name: "Friends", isPrivate: true },
  { id: "3", name: "Founders", memberCount: 1 },
];

function cacheOf(load: () => Promise<XList[]>): ListCache {
  return { cached: async () => null, refresh: load };
}

function mirror(): MembershipStore {
  return {
    recordAssign: async () => {},
    reconcileAuthor: async () => {},
    replaceCatalog: async () => {},
    observe: (_subject, emit) => {
      emit({
        catalog: [
          {
            owner: FOREIGN,
            lists: [{ id: "F1", name: "Foreign List" }],
            lastReconciledAt: Date.now() - 2 * 86_400_000,
          },
        ],
        memberships: [
          {
            ownerUserId: FOREIGN.userId,
            listId: "F1",
            present: true,
            lastSeenAt: 456,
          },
        ],
      });
      return () => {};
    },
  };
}

async function setup(
  options: {
    lists?: () => Promise<XList[]>;
    recentIds?: () => Promise<string[]>;
    memberships?: () => Promise<string[] | null>;
    membershipStore?: MembershipStore;
    authors?: TweetAuthor[];
  } = {},
) {
  const picker = createPickerController({
    cache: cacheOf(options.lists ?? (async () => LISTS)),
    currentOwner: () => OWNER,
    ...(options.recentIds ? { recentIds: options.recentIds } : {}),
    ...(options.memberships ? { memberships: options.memberships } : {}),
    ...(options.membershipStore ? { membershipStore: options.membershipStore } : {}),
  });
  await picker.open(options.authors ?? [{ screenName: "jane" }]);
  const onEffect = vi.fn();
  const onCancel = vi.fn();
  const onCreateList = vi.fn();
  const result = render(
    <ListPicker
      picker={picker}
      onEffect={onEffect}
      onCancel={onCancel}
      onCreateList={onCreateList}
    />,
  );
  const input = () => result.container.querySelector("input") as HTMLInputElement;
  const optionsText = () =>
    [...result.container.querySelectorAll('[role="option"]')].map(
      (element) => element.querySelector("span")?.textContent,
    );
  return {
    ...result,
    picker,
    input,
    optionsText,
    onEffect,
    onCancel,
    onCreateList,
  };
}

describe("ListPicker", () => {
  it("renders ready anatomy, recents, counts, and private state", async () => {
    const screen = await setup({
      authors: [{ screenName: "a" }, { screenName: "b" }, { screenName: "c" }],
      recentIds: async () => ["3"],
    });
    expect(screen.getByText("Add 3 people to a List")).toBeTruthy();
    expect(screen.input().placeholder).toBe("Search Lists");
    expect(screen.optionsText()).toEqual(["Founders", "Research", "Friends"]);
    expect(screen.getByText("1,204 members")).toBeTruthy();
    expect(screen.getByLabelText("Private")).toBeTruthy();
    expect(screen.getByText("↑↓ Navigate · Enter Add · Esc Dismiss · 3 selected")).toBeTruthy();
  });

  it("routes one choice through the guarded Picker effect", async () => {
    const screen = await setup();
    fireEvent.input(screen.input(), { target: { value: "f" } });
    await waitFor(() => expect(screen.optionsText()).toEqual(["Founders", "Friends"]));
    fireEvent.keyDown(screen.input(), { key: "ArrowDown" });
    fireEvent.keyDown(screen.input(), { key: "Enter" });
    expect(screen.onEffect).toHaveBeenCalledWith({
      type: "chosen",
      owner: OWNER,
      list: expect.objectContaining({ name: "Friends" }),
      authors: [{ screenName: "jane" }],
    });
    fireEvent.click(screen.container.querySelector('[role="option"]')!);
    expect(screen.onEffect).toHaveBeenCalledOnce();
  });

  it("keeps pointer down focus-only but accepts click option activation", async () => {
    const screen = await setup();
    const option = screen.container.querySelector('[role="option"]')!;
    fireEvent.mouseDown(option);
    expect(screen.onEffect).not.toHaveBeenCalled();

    fireEvent.click(option);
    expect(screen.onEffect).toHaveBeenCalledWith({
      type: "chosen",
      owner: OWNER,
      list: expect.objectContaining({ name: "Research" }),
      authors: [{ screenName: "jane" }],
    });
  });

  it("accepts Enter and Space on a writable row, and stops them at the picker", async () => {
    const screen = await setup();
    const option = screen.container.querySelector('[role="option"]')!;
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    try {
      fireEvent.keyDown(option, { key: "Enter" });
      fireEvent.keyDown(option, { key: "x" });
    } finally {
      document.removeEventListener("keydown", pageKeydown);
    }
    expect(screen.onEffect).toHaveBeenCalledTimes(1);
    expect(pageKeydown).toHaveBeenCalledTimes(1);

    const space = await setup();
    fireEvent.keyDown(space.container.querySelector('[role="option"]')!, {
      key: " ",
    });
    expect(space.onEffect).toHaveBeenCalledTimes(1);
  });

  it("handles ArrowUp, no active Enter, ignored keys, and a null choose effect", async () => {
    const screen = await setup();
    fireEvent.keyDown(screen.input(), { key: "ArrowDown" });
    fireEvent.keyDown(screen.input(), { key: "ArrowUp" });
    fireEvent.keyDown(screen.input(), { key: "Tab" });
    const act = vi.spyOn(screen.picker, "act").mockReturnValueOnce(null);
    fireEvent.click(screen.container.querySelector('[role="option"]')!);
    expect(screen.onEffect).not.toHaveBeenCalled();
    act.mockRestore();

    fireEvent.input(screen.input(), { target: { value: "no-match" } });
    fireEvent.keyDown(screen.input(), { key: "Enter" });
    expect(screen.onEffect).not.toHaveBeenCalled();
  });

  it("shows live membership in blue", async () => {
    const screen = await setup({ memberships: async () => ["2"] });
    const mark = screen.getByLabelText("Already in");
    expect(mark.getAttribute("data-membership-source")).toBe("x-live");
  });

  it("shows Owner tabs, all-account badges, cached checks, and inert foreign rows", async () => {
    const screen = await setup({
      membershipStore: mirror(),
      authors: [{ screenName: "jane", userId: "300" }],
    });
    fireEvent.click(screen.getByText(/@alt · as of 2d ago/));
    expect(screen.getByText("Switch to @alt on X to add here")).toBeTruthy();
    const foreign = screen.getByRole("option");
    expect(foreign.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(foreign);
    expect(screen.onEffect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("All accounts"));
    expect(screen.getByText("Switch to @alt")).toBeTruthy();
    const cached = screen.getByLabelText("Already in");
    expect(cached.getAttribute("data-membership-source")).toBe("mirror-cached");
  });

  it("formats Owner freshness without inventing precision", () => {
    const now = 10 * 86_400_000;
    expect(freshnessLabel({ kind: "active" }, now)).toBe("active");
    expect(freshnessLabel({ kind: "cached" }, now)).toBe("as of last use");
    expect(freshnessLabel({ kind: "cached", asOf: now - 1 }, now)).toBe("as of today");
    expect(freshnessLabel({ kind: "cached", asOf: now - 2 * 86_400_000 }, now)).toBe(
      "as of 2d ago",
    );
  });

  it("supports no-match, clear, and Escape", async () => {
    const screen = await setup();
    fireEvent.input(screen.input(), { target: { value: "xyz" } });
    await waitFor(() => expect(screen.getByText('No Lists match "xyz"')).toBeTruthy());
    fireEvent.click(screen.getByText("Clear search"));
    expect(screen.optionsText()).toHaveLength(3);
    fireEvent.keyDown(screen.input(), { key: "Escape" });
    expect(screen.onCancel).toHaveBeenCalledOnce();
  });

  it("renders empty and error recovery states", async () => {
    const empty = await setup({ lists: async () => [] });
    expect(empty.getByText("You don't have any Lists yet")).toBeTruthy();
    fireEvent.click(empty.getByText("Create a List on X"));
    expect(empty.onCreateList).toHaveBeenCalledOnce();

    let fail = true;
    const error = await setup({
      lists: async () => {
        if (fail) throw new XApiError("rate-limited", "429");
        return LISTS;
      },
    });
    expect(error.getByText("X rate limited Lasso — try again in a few minutes")).toBeTruthy();
    fail = false;
    fireEvent.click(error.getByText("Retry"));
    await waitFor(() => expect(error.picker.view.value.status).toBe("ready"));
  });

  it("focuses the dialog while a retry is pending", async () => {
    let attempt = 0;
    const screen = await setup({
      lists: () => {
        attempt++;
        if (attempt === 1) return Promise.reject(new XApiError("auth", "failed"));
        return new Promise<XList[]>(() => {});
      },
    });
    const retry = screen.getByText("Retry");
    expect(document.activeElement).toBe(retry);

    fireEvent.click(retry);
    await waitFor(() => expect(screen.picker.view.value.status).toBe("loading"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(dialog);
  });

  it("handles auth, unknown, and retry-key recovery", async () => {
    let kind: "auth" | "unknown" = "auth";
    let fail = true;
    const screen = await setup({
      lists: async () => {
        if (fail) throw new XApiError(kind, "failed");
        return LISTS;
      },
    });
    expect(screen.getByText("You may be logged out of X")).toBeTruthy();
    fireEvent.keyDown(screen.getByText("Retry"), { key: "x" });
    // The document keyboard owner closes a non-editable Retry button. Keeping
    // this component silent avoids a second close after capture phase.
    fireEvent.keyDown(screen.getByText("Retry"), { key: "Escape" });
    expect(screen.onCancel).not.toHaveBeenCalled();

    kind = "unknown";
    screen.picker.act({ type: "retry" });
    await waitFor(() => expect(screen.getByText("X didn't respond — try again")).toBeTruthy());
    fail = false;
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    fireEvent.keyDown(screen.getByText("Retry"), { key: "r" });
    document.removeEventListener("keydown", pageKeydown);
    expect(pageKeydown).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.picker.view.value.status).toBe("ready"));
  });

  it("shows loading skeletons while X is pending", () => {
    const picker = createPickerController({
      cache: cacheOf(() => new Promise<XList[]>(() => {})),
      currentOwner: () => OWNER,
    });
    void picker.open([{ screenName: "jane" }]);
    const { container, getByRole } = render(
      <ListPicker
        picker={picker}
        onEffect={() => {}}
        onCancel={() => {}}
        onCreateList={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-loading-row]")).toHaveLength(3);
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(dialog);
  });

  it("links combobox navigation to the active option", async () => {
    const screen = await setup();
    const input = screen.input();
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]?.id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]?.id);
  });

  it("stops owned combobox keys before they reach the page", async () => {
    const screen = await setup();
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    try {
      for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
        fireEvent.keyDown(screen.input(), { key });
      }
      expect(pageKeydown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pageKeydown);
    }
  });

  it("focuses and traps the editable combobox in a shadow-root dialog, then restores focus", async () => {
    const outside = document.createElement("button");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);
    document.body.append(outside, host);
    outside.focus();

    const picker = createPickerController({
      cache: cacheOf(async () => LISTS),
      currentOwner: () => OWNER,
    });
    await picker.open([{ screenName: "jane" }]);
    const rendered = render(
      <ListPicker
        picker={picker}
        onEffect={() => {}}
        onCancel={() => {}}
        onCreateList={() => {}}
      />,
      { container: mount },
    );
    const input = shadow.querySelector<HTMLInputElement>("input")!;
    expect(shadow.activeElement).toBe(input);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(input);

    rendered.unmount();
    expect(document.activeElement).toBe(outside);
    host.remove();
    outside.remove();
  });
});
