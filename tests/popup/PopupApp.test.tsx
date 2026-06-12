import { fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { PopupApp } from "@/popup/PopupApp";

describe("PopupApp — the toolbar surface (story beat 9)", () => {
  it("shows the active state line and the top-3 shortcuts", async () => {
    const { getByText } = render(
      <PopupApp
        queryState={async () => "active"}
        wake={async () => {}}
        openOptions={() => {}}
        platform="other"
      />,
    );
    await waitFor(() => expect(getByText("Active on x.com")).toBeTruthy());
    expect(getByText("File the author into a List")).toBeTruthy();
    expect(getByText("Select many people")).toBeTruthy();
    expect(getByText("Every shortcut")).toBeTruthy();
  });

  it("asleep tabs offer click-to-wake and flip to active", async () => {
    const wake = vi.fn(async () => {});
    const { getByText } = render(
      <PopupApp
        queryState={async () => "asleep"}
        wake={wake}
        openOptions={() => {}}
        platform="other"
      />,
    );
    await waitFor(() => expect(getByText("Asleep — click to wake")).toBeTruthy());
    fireEvent.click(getByText("Asleep — click to wake"));
    expect(wake).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getByText("Active on x.com")).toBeTruthy());
  });

  it("links to all settings", async () => {
    const openOptions = vi.fn();
    const { getByText } = render(
      <PopupApp
        queryState={async () => "off-x"}
        wake={async () => {}}
        openOptions={openOptions}
        platform="other"
      />,
    );
    await waitFor(() => expect(getByText("Open x.com to use Lasso")).toBeTruthy());
    fireEvent.click(getByText("All settings →"));
    expect(openOptions).toHaveBeenCalledTimes(1);
  });
});
