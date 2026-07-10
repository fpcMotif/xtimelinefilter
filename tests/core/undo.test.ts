import { describe, expect, it, vi } from "vitest";

import { createUndoRegistry } from "@/core/undo";

function manualTimers() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer(fn: () => void, _ms: number): number {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clearTimer(id: number): void {
      pending.delete(id);
    },
    fireAll(): void {
      for (const [id, fn] of Array.from(pending)) {
        fn();
        pending.delete(id);
      }
    },
  };
}

describe("createUndoRegistry", () => {
  it("triggers the armed undo exactly once", () => {
    const reg = createUndoRegistry(manualTimers());
    const run = vi.fn();
    reg.arm(run, 10_000);
    expect(reg.trigger()).toBe(true);
    expect(reg.trigger()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does nothing when nothing is armed", () => {
    const reg = createUndoRegistry(manualTimers());
    expect(reg.trigger()).toBe(false);
  });

  it("swallows a throwing undo callback and still disarms (shared registry, ADR-0010)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reg = createUndoRegistry(manualTimers());
    reg.arm(() => {
      throw new Error("filter restore blew up");
    }, 10_000);
    let result: boolean | undefined;
    expect(() => {
      result = reg.trigger();
    }).not.toThrow(); // the throw never escapes into the keyboard flow
    expect(result).toBe(true);
    expect(reg.trigger()).toBe(false); // disarmed even though the callback threw
    expect(warn).toHaveBeenCalledWith("[Lasso] undo callback threw", expect.any(Error));
    warn.mockRestore();
  });

  it("expires after its window", () => {
    const timers = manualTimers();
    const reg = createUndoRegistry(timers);
    const run = vi.fn();
    reg.arm(run, 10_000);
    timers.fireAll();
    expect(reg.trigger()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("re-arming replaces the previous undo", () => {
    const reg = createUndoRegistry(manualTimers());
    const first = vi.fn();
    const second = vi.fn();
    reg.arm(first, 10_000);
    reg.arm(second, 10_000);
    expect(reg.trigger()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("the default real timers expire via window.setTimeout and clear on disarm", () => {
    vi.useFakeTimers();
    try {
      const reg = createUndoRegistry(); // exercises realTimers (window.set/clearTimeout)
      const run = vi.fn();
      reg.arm(run, 10_000);
      vi.advanceTimersByTime(10_000); // disarm scheduled via window.setTimeout fires
      expect(reg.trigger()).toBe(false);
      expect(run).not.toHaveBeenCalled();

      const run2 = vi.fn();
      reg.arm(run2, 10_000);
      reg.disarm(); // clearTimer arrow runs (window.clearTimeout)
      vi.advanceTimersByTime(10_000);
      expect(reg.trigger()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
