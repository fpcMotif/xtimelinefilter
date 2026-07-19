import { describe, expect, it, vi } from "vitest";

import { createBadgeReannouncer } from "@/content/badge-lifecycle";

describe("badge lifecycle reannouncement", () => {
  it("reannounces the retained awake selection", () => {
    const state = vi.fn(() => "awake" as const);
    const dormant = vi.fn();
    const reporter = vi.fn();
    const badge = createBadgeReannouncer({ activationState: state, publishDormant: dormant });
    badge.setAwakeReporter(reporter);

    badge.reannounce();

    expect(reporter).toHaveBeenCalledOnce();
    expect(dormant).not.toHaveBeenCalled();
  });

  it("reannounces dormant state but leaves a boot in flight alone", () => {
    let state: "idle" | "booting" = "idle";
    const dormant = vi.fn();
    const badge = createBadgeReannouncer({ activationState: () => state, publishDormant: dormant });

    badge.reannounce();
    state = "booting";
    badge.reannounce();

    expect(dormant).toHaveBeenCalledOnce();
  });

  it("does not let a failed install clear a later reporter", () => {
    const first = vi.fn();
    const second = vi.fn();
    const badge = createBadgeReannouncer({
      activationState: () => "awake",
      publishDormant: vi.fn(),
    });
    const disposeFirst = badge.setAwakeReporter(first);
    badge.setAwakeReporter(second);

    disposeFirst();
    badge.reannounce();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
