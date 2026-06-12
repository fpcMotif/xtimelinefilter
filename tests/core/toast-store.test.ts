import { describe, expect, it, vi } from "vitest";

import { createToastStore } from "@/core/toast-store";

/** Manual timer harness so auto-dismiss is deterministic. */
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
    fire(id: number): void {
      pending.get(id)?.();
      pending.delete(id);
    },
    fireAll(): void {
      for (const id of Array.from(pending.keys())) this.fire(id);
    },
    get count(): number {
      return pending.size;
    },
  };
}

describe("createToastStore", () => {
  it("shows a toast and auto-dismisses success/info after the default duration", () => {
    const timers = manualTimers();
    const store = createToastStore(timers);
    store.show({ kind: "success", title: "Added 1 to Design Folks" });
    expect(store.toasts.value).toHaveLength(1);
    timers.fireAll();
    expect(store.toasts.value).toHaveLength(0);
  });

  it("danger toasts persist until dismissed (no auto-dismiss)", () => {
    const timers = manualTimers();
    const store = createToastStore(timers);
    const id = store.show({ kind: "danger", title: "Nothing was added" });
    expect(timers.count).toBe(0);
    store.dismiss(id);
    expect(store.toasts.value).toHaveLength(0);
  });

  it("a custom duration wins; null means persist", () => {
    const timers = manualTimers();
    const store = createToastStore(timers);
    store.show({ kind: "info", title: "tip", durationMs: null });
    expect(timers.count).toBe(0);
    store.show({ kind: "danger", title: "but timed", durationMs: 10 });
    expect(timers.count).toBe(1);
  });

  it("running an action dismisses its toast", () => {
    const timers = manualTimers();
    const store = createToastStore(timers);
    const run = vi.fn();
    const id = store.show({
      kind: "success",
      title: "Muted @jane",
      actions: [{ label: "Undo", kbd: "Z", run }],
    });
    store.act(id, 0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.toasts.value).toHaveLength(0);
    expect(timers.count).toBe(0); // dismissing also clears the pending timer
  });

  it("stacks multiple toasts and dismisses each independently", () => {
    const timers = manualTimers();
    const store = createToastStore(timers);
    const a = store.show({ kind: "info", title: "a" });
    store.show({ kind: "info", title: "b" });
    store.dismiss(a);
    expect(store.toasts.value.map((t) => t.title)).toEqual(["b"]);
  });
});
