import { type Signal, signal } from "@preact/signals-core";

import type { SelectionStore } from "@/core/selection-store";

/** Progress surface while a run is in flight (story beat 7). */
export interface RunningAssign {
  current: number;
  total: number;
  listName: string;
}

/**
 * The content UI's open-surface state and the single deterministic Esc grammar
 * (story beat 6): dialog → picker → review popover → select mode → clear
 * selection. handleEscape returns false when Lasso consumed nothing, so X's own
 * Escape behavior is never shadowed.
 */
/** Viewport position for a caret-anchored picker (story beat 6); null = bottom-center. */
export interface PickerAnchor {
  left: number;
  top: number;
}

export interface AppState {
  welcomeOpen: Signal<boolean>;
  shortcutsOpen: Signal<boolean>;
  pickerOpen: Signal<boolean>;
  reviewOpen: Signal<boolean>;
  pickerAnchor: Signal<PickerAnchor | null>;
  running: Signal<RunningAssign | null>;
  handleEscape(): boolean;
}

export function createAppState(selection: SelectionStore): AppState {
  const welcomeOpen = signal(false);
  const shortcutsOpen = signal(false);
  const pickerOpen = signal(false);
  const reviewOpen = signal(false);
  const pickerAnchor = signal<PickerAnchor | null>(null);
  const running = signal<RunningAssign | null>(null);

  function handleEscape(): boolean {
    if (welcomeOpen.value) {
      welcomeOpen.value = false;
      return true;
    }
    if (shortcutsOpen.value) {
      shortcutsOpen.value = false;
      return true;
    }
    if (pickerOpen.value) {
      pickerOpen.value = false;
      return true;
    }
    if (reviewOpen.value) {
      reviewOpen.value = false;
      return true;
    }
    if (selection.selectMode.value) {
      selection.setSelectMode(false); // exiting select mode keeps the selection
      return true;
    }
    if (selection.count.value > 0) {
      selection.clear();
      return true;
    }
    return false;
  }

  return {
    welcomeOpen,
    shortcutsOpen,
    pickerOpen,
    reviewOpen,
    pickerAnchor,
    running,
    handleEscape,
  };
}
