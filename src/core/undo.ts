import type { ToastTimers } from "@/core/toast-store";

/**
 * Tracks the single most recent undoable action so the global `Z` key can
 * trigger it inside its window (story beats 4 & 6). Arming replaces any prior
 * undo; expiry disarms silently.
 */
export interface UndoRegistry {
  arm(run: () => void, windowMs: number): void;
  /** Run + disarm the active undo; false if none is armed. */
  trigger(): boolean;
  disarm(): void;
}

const realTimers: ToastTimers = {
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
};

export function createUndoRegistry(timers: ToastTimers = realTimers): UndoRegistry {
  let active: { run: () => void; timer: number } | null = null;

  function disarm(): void {
    if (active) timers.clearTimer(active.timer);
    active = null;
  }

  return {
    arm(run, windowMs) {
      disarm();
      active = { run, timer: timers.setTimer(disarm, windowMs) };
    },
    trigger() {
      if (!active) return false;
      const { run } = active;
      disarm();
      run();
      return true;
    },
    disarm,
  };
}
