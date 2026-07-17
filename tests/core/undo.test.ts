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

  it("runs only the token-matching action when a token is given", () => {
    const reg = createUndoRegistry(manualTimers());
    const first = vi.fn();
    const second = vi.fn();
    const t1 = reg.arm(first, 10_000);
    const t2 = reg.arm(second, 10_000);
    expect(reg.trigger(t1)).toBe(false); // superseded: no-op, second stays armed
    expect(first).not.toHaveBeenCalled();
    expect(reg.trigger(t2)).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("a stale token no-ops after the armed action already fired", () => {
    const reg = createUndoRegistry(manualTimers());
    const run = vi.fn();
    const token = reg.arm(run, 10_000);
    expect(reg.trigger()).toBe(true);
    expect(reg.trigger(token)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
