import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import type { XList } from "@/core/x-client/types";
import { ListPicker } from "@/ui/ListPicker";

const lists: XList[] = [
  { id: "1", name: "Research" },
  { id: "2", name: "Friends" },
  { id: "3", name: "Founders" },
];

function setup() {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const r = render(<ListPicker lists={lists} onPick={onPick} onCancel={onCancel} />);
  const input = r.container.querySelector("input") as HTMLInputElement;
  const options = () =>
    [...r.container.querySelectorAll('[role="option"]')].map((e) => e.textContent);
  return { ...r, input, options, onPick, onCancel };
}

describe("ListPicker", () => {
  it("shows all lists initially", () => {
    const { options } = setup();
    expect(options()).toEqual(["Research", "Friends", "Founders"]);
  });

  it("filters fuzzily as you type", async () => {
    const { input, options } = setup();
    fireEvent.input(input, { target: { value: "frie" } });
    await waitFor(() => expect(options()).toEqual(["Friends"]));
  });

  it("picks the active item on Enter", async () => {
    const { input, onPick } = setup();
    fireEvent.input(input, { target: { value: "research" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "Research" })),
    );
  });

  it("ArrowDown then Enter picks the second item", async () => {
    const { input, onPick } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "Friends" })),
    );
  });

  it("Escape cancels", () => {
    const { input, onCancel } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows an empty state when nothing matches", async () => {
    const { input, container } = setup();
    fireEvent.input(input, { target: { value: "zzz" } });
    await waitFor(() => expect(container.textContent).toContain("No matching lists"));
  });
});
