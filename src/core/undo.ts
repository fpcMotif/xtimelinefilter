import type { ToastTimers } from "@/core/toast-store";

/**
 * Tracks the single most recent undoable action so the global `Z` key can
 * trigger it inside its window (story beats 4 & 6). Arming replaces any prior
 * undo; expiry disarms silently.
 */
export interface UndoRegistry {
  /** Arm an undo; returns a token identifying THIS armed action. */
  arm(run: () => void, windowMs: number): number;
  /**
   * Run + disarm the active undo; false if none is armed. With a token, runs
   * only if that exact action is still the armed one (a superseded toast's
   * button no-ops); without a token (the Z key), runs the latest.
   */
  trigger(token?: number): boolean;
  disarm(): void;
}

const realTimers: ToastTimers = {
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
};

export function createUndoRegistry(timers: ToastTimers = realTimers): UndoRegistry {
  let active: { run: () => void; timer: number; token: number } | null = null;
  let nextToken = 1;

  function disarm(): void {
    if (active) timers.clearTimer(active.timer);
    active = null;
  }

  return {
    arm(run, windowMs) {
      disarm();
      const token = nextToken++;
      active = { run, timer: timers.setTimer(disarm, windowMs), token };
      return token;
    },
    trigger(token?: number) {
      if (!active) return false;
      if (token !== undefined && token !== active.token) return false;
      const { run } = active;
      disarm();
      run();
      return true;
    },
    disarm,
  };
}
