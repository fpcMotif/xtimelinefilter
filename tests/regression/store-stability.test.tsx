import { render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import * as filterMod from "@/core/filter-store";
import * as settingsMod from "@/core/settings";
import { OptionsApp } from "@/options/OptionsApp";
import { PopupApp } from "@/popup/PopupApp";

/**
 * Regression guard for the "flips then reverts" save bug (live-verified in a real
 * loaded extension): OptionsApp/PopupApp once created their stores as PARAMETER
 * DEFAULTS (`filter = createFilterStore()`), which re-run on every render. Each
 * render produced a fresh store + signal that fed the useEffect deps and
 * useSignalValue, so a real browser spun an infinite render loop that pegged the
 * main thread and dropped every edit. The entry points mount these prop-less, so
 * the loop only bit production — happy-dom's effect scheduling never sustained it,
 * which is why every unit test stayed green. We pin the invariant directly: a
 * prop-less mount must construct each store EXACTLY ONCE, not once per render.
 */
describe("store stability — no per-render store construction", () => {
  it("OptionsApp (mounted prop-less, like the entry point) builds each store once", async () => {
    const settingsSpy = vi.spyOn(settingsMod, "createSettings");
    const filterSpy = vi.spyOn(filterMod, "createFilterStore");

    const { container } = render(<OptionsApp />);
    await waitFor(() => expect(container.querySelector("main")).toBeTruthy());
    // Drain any pending effect/promise cascade — a per-render factory would keep
    // climbing past 1 as setCurrent/setValue re-rendered.
    await new Promise((r) => setTimeout(r, 30));

    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(filterSpy).toHaveBeenCalledTimes(1);
  });

  it("PopupApp (mounted prop-less, like the entry point) builds each store once", async () => {
    const filterSpy = vi.spyOn(filterMod, "createFilterStore");
    const settingsSpy = vi.spyOn(settingsMod, "createSettings");

    const r = render(
      <PopupApp queryState={async () => "active"} wake={async () => {}} openOptions={() => {}} />,
    );
    await waitFor(() => expect(r.getByText("Active")).toBeTruthy());
    await new Promise((res) => setTimeout(res, 30));

    expect(filterSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
  });
});
