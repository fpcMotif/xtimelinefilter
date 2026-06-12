import { type ReadonlySignal, signal } from "@preact/signals-core";

/**
 * Headless toast queue (story beats 4–8): success/info toasts auto-dismiss,
 * danger toasts persist until dismissed ("failure copy is always literal — no
 * charm at the moment of loss"). Actions (View List / Undo / Retry) dismiss
 * their toast when run. Timers are injected for deterministic tests.
 */

export type ToastKind = "success" | "info" | "danger";

export interface ToastAction {
  label: string;
  /** Keycap chip rendered beside the label (e.g. "Z" for Undo). */
  kbd?: string;
  run(): void;
}

export interface ToastSpec {
  kind: ToastKind;
  title: string;
  /** Optional second line (reason / idempotent note). */
  line?: string;
  actions?: ToastAction[];
  /** Auto-dismiss delay; null = persist until dismissed. Defaults: danger null, others 4s. */
  durationMs?: number | null;
}

export interface ActiveToast extends ToastSpec {
  id: number;
}

export interface ToastTimers {
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

export interface ToastStore {
  toasts: ReadonlySignal<ActiveToast[]>;
  show(spec: ToastSpec): number;
  dismiss(id: number): void;
  /** Run an action by index, then dismiss the toast. */
  act(id: number, actionIndex: number): void;
  clear(): void;
}

export const DEFAULT_TOAST_MS = 4000;

const realTimers: ToastTimers = {
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
};

export function createToastStore(timers: ToastTimers = realTimers): ToastStore {
  const toasts = signal<ActiveToast[]>([]);
  const pending = new Map<number, number>(); // toast id → timer id
  let nextId = 1;

  function dismiss(id: number): void {
    const timer = pending.get(id);
    if (timer !== undefined) {
      timers.clearTimer(timer);
      pending.delete(id);
    }
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    show(spec) {
      const id = nextId++;
      toasts.value = [...toasts.value, { ...spec, id }];
      const duration =
        spec.durationMs !== undefined
          ? spec.durationMs
          : spec.kind === "danger"
            ? null
            : DEFAULT_TOAST_MS;
      if (duration !== null)
        pending.set(
          id,
          timers.setTimer(() => dismiss(id), duration),
        );
      return id;
    },
    dismiss,
    act(id, actionIndex) {
      const toast = toasts.value.find((t) => t.id === id);
      const action = toast?.actions?.[actionIndex];
      dismiss(id);
      action?.run();
    },
    clear() {
      const open = toasts.value;
      for (const t of open) dismiss(t.id);
    },
  };
}
