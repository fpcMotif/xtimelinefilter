import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFolderPickerController, type FolderSource } from "@/core/folder-picker-controller";
import type { Folder, PostCapture } from "@/packages/folders/types";
import { FolderPicker } from "@/ui/FolderPicker";

const folder = (folderId: string, name: string): Folder => ({
  folderId,
  name,
  sortIndex: 0,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

const CAPTURE: PostCapture = {
  statusId: "12345",
  permalink: "https://x.com/jack/status/12345",
  media: [],
};

const FOLDERS: Folder[] = [folder("fld_a", "Research"), folder("fld_b", "Friends")];

function sourceOf(options: {
  folders?: () => Promise<Folder[]>;
  holding?: () => Promise<string[]>;
}): FolderSource {
  return {
    listFolders: options.folders ?? (async () => FOLDERS),
    foldersHolding: options.holding ?? (async () => []),
  };
}

async function setup(
  options: {
    folders?: () => Promise<Folder[]>;
    holding?: () => Promise<string[]>;
  } = {},
) {
  const picker = createFolderPickerController({ collections: sourceOf(options) });
  await picker.open(CAPTURE);
  const onEffect = vi.fn();
  const onCancel = vi.fn();
  const result = render(<FolderPicker picker={picker} onEffect={onEffect} onCancel={onCancel} />);
  const input = () => result.container.querySelector("input") as HTMLInputElement;
  const optionsText = () =>
    [...result.container.querySelectorAll('[role="option"]')].map(
      (element) => element.querySelector("span")?.textContent,
    );
  return { ...result, picker, input, optionsText, onEffect, onCancel };
}

describe("FolderPicker", () => {
  it("renders ready anatomy and marks the Folder already holding this post", async () => {
    const screen = await setup({ holding: async () => ["fld_b"] });
    expect(screen.getByText("Save to a Folder")).toBeTruthy();
    expect(screen.input().placeholder).toBe("Search Folders");
    expect(screen.optionsText()).toEqual(["Research", "Friends"]);
    expect(screen.getByLabelText("Already in this Folder")).toBeTruthy();
    expect(screen.getByText("↑↓ Navigate · Enter Save · Esc Dismiss")).toBeTruthy();
  });

  it("routes a click choice through the guarded picker effect", async () => {
    const screen = await setup();
    fireEvent.click(screen.container.querySelector('[role="option"]')!);
    expect(screen.onEffect).toHaveBeenCalledWith({
      type: "chosen",
      folderId: "fld_a",
      folderName: "Research",
      capture: CAPTURE,
    });
    // The choice is already consumed — a second click answers nothing.
    fireEvent.click(screen.container.querySelector('[role="option"]')!);
    expect(screen.onEffect).toHaveBeenCalledOnce();
  });

  it("keeps pointer down focus-only but accepts click row activation", async () => {
    const screen = await setup();
    const option = screen.container.querySelector('[role="option"]')!;
    fireEvent.mouseDown(option);
    expect(screen.onEffect).not.toHaveBeenCalled();
    fireEvent.click(option);
    expect(screen.onEffect).toHaveBeenCalledOnce();
  });

  it("accepts Enter and Space on a row, and stops them at the picker", async () => {
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
    fireEvent.keyDown(space.container.querySelector('[role="option"]')!, { key: " " });
    expect(space.onEffect).toHaveBeenCalledTimes(1);
  });

  it("navigates with arrow keys and saves the active row on Enter", async () => {
    const screen = await setup();
    const input = screen.input();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]?.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0]?.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.onEffect).toHaveBeenCalledWith(expect.objectContaining({ folderId: "fld_a" }));
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

  it("ignores keys it does not own, and a null choose effect", async () => {
    const screen = await setup();
    fireEvent.keyDown(screen.input(), { key: "Tab" });
    expect(screen.onEffect).not.toHaveBeenCalled();
    const act = vi.spyOn(screen.picker, "act").mockReturnValueOnce(null);
    fireEvent.click(screen.container.querySelector('[role="option"]')!);
    expect(screen.onEffect).not.toHaveBeenCalled();
    act.mockRestore();

    fireEvent.input(screen.input(), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText('No Folders match "zzz"')).toBeTruthy());
    fireEvent.keyDown(screen.input(), { key: "Enter" });
    expect(screen.onEffect).not.toHaveBeenCalled();
  });

  it("closes on Escape and reports cancel", async () => {
    const screen = await setup();
    fireEvent.keyDown(screen.input(), { key: "Escape" });
    expect(screen.onCancel).toHaveBeenCalledOnce();
  });

  it("supports no-match and clear", async () => {
    const screen = await setup();
    fireEvent.input(screen.input(), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText('No Folders match "zzz"')).toBeTruthy());
    fireEvent.click(screen.getByText("Clear search"));
    expect(screen.optionsText()).toHaveLength(2);
  });

  it("renders the empty state with no Folders at all", async () => {
    const screen = await setup({ folders: async () => [] });
    expect(screen.getByText("You don't have any Folders yet")).toBeTruthy();
    expect(screen.getByText("Create one in Options to start filing posts")).toBeTruthy();
  });

  it("renders error recovery and retries", async () => {
    let fail = true;
    const screen = await setup({
      folders: async () => {
        if (fail) throw new Error("worker down");
        return FOLDERS;
      },
    });
    expect(screen.getByText("Couldn't load your Folders")).toBeTruthy();
    expect(screen.getByText("Something went wrong — try again")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.picker.view.value.status).toBe("ready"));
  });

  it("focuses the dialog while loading, then the input, and the retry button on error", () => {
    const picker = createFolderPickerController({
      collections: sourceOf({ folders: () => new Promise<Folder[]>(() => {}) }),
    });
    void picker.open(CAPTURE);
    const { container, getByRole } = render(
      <FolderPicker picker={picker} onEffect={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelectorAll("[data-loading-row]")).toHaveLength(3);
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(dialog);
  });

  it("focuses the retry button once an open errors", async () => {
    const screen = await setup({
      folders: async () => {
        throw new Error("down");
      },
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Retry")));
  });
});
