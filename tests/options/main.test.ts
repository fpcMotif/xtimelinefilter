import { describe, expect, it, vi } from "vitest";

// The options entry only mounts OptionsApp into #root; mock preact's render so
// importing the module is a pure wiring assertion (no real DOM tree built).
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("preact", async () => {
  const actual = await vi.importActual<typeof import("preact")>("preact");
  return { ...actual, render };
});

describe("options entry", () => {
  it("renders OptionsApp into #root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    render.mockClear();
    vi.resetModules();

    await import("@/options/main");

    expect(render).toHaveBeenCalledTimes(1);
    const [vnode, container] = render.mock.calls[0] as [{ type: unknown }, unknown];
    expect(container).toBe(document.getElementById("root"));
    // The mounted vnode is the OptionsApp component (a function component).
    expect(typeof vnode.type).toBe("function");
  });
});
