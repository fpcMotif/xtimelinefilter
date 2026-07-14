import { describe, expect, it, vi } from "vitest";

import { createOverlayLifecycle } from "@/content/overlay-lifecycle";

describe("createOverlayLifecycle", () => {
  it("attach stores the disposer mount() returns", () => {
    const article = document.createElement("article");
    const dispose = vi.fn();
    const overlays = createOverlayLifecycle();

    overlays.attach(article, () => dispose);
    overlays.releaseFor(article);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("attach is a no-op when mount() returns null (already mounted)", () => {
    const article = document.createElement("article");
    const mount = vi.fn(() => null);
    const overlays = createOverlayLifecycle();

    overlays.attach(article, mount);
    overlays.releaseFor(article); // nothing was stored — harmless

    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("a re-scan whose mount() returns null keeps the original disposer intact", () => {
    const article = document.createElement("article");
    const dispose = vi.fn();
    const overlays = createOverlayLifecycle();

    overlays.attach(article, () => dispose); // first mount succeeds
    overlays.attach(article, () => null); // re-scan: overlay already present
    overlays.releaseFor(article);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releaseFor on an article that was never attached is a harmless no-op", () => {
    const overlays = createOverlayLifecycle();
    expect(() => overlays.releaseFor(document.createElement("article"))).not.toThrow();
  });

  it("releaseFor twice on the same article disposes only once", () => {
    const article = document.createElement("article");
    const dispose = vi.fn();
    const overlays = createOverlayLifecycle();

    overlays.attach(article, () => dispose);
    overlays.releaseFor(article);
    overlays.releaseFor(article);

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposeAll runs every live disposer and clears the registry", () => {
    const a = document.createElement("article");
    const b = document.createElement("article");
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    const overlays = createOverlayLifecycle();

    overlays.attach(a, () => disposeA);
    overlays.attach(b, () => disposeB);
    overlays.disposeAll();

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);

    // The registry is empty afterward — releasing either article is a no-op.
    overlays.releaseFor(a);
    expect(disposeA).toHaveBeenCalledTimes(1);
  });
});
