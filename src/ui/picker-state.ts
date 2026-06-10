import { computed, type ReadonlySignal, signal } from "@preact/signals-core";

import { fuzzyRank } from "@/core/fuzzy";
import type { XList } from "@/core/x-client/types";

/**
 * Headless, framework-agnostic state for the keyboard-first List picker (swift UX).
 * The Preact component is a thin render over this; logic is unit-tested without a DOM.
 */
export interface PickerState {
  query: ReadonlySignal<string>;
  results: ReadonlySignal<XList[]>;
  activeIndex: ReadonlySignal<number>;
  active: ReadonlySignal<XList | null>;
  setQuery(q: string): void;
  moveUp(): void;
  moveDown(): void;
  reset(): void;
}

const clamp = (i: number, len: number): number =>
  len === 0 ? 0 : Math.max(0, Math.min(i, len - 1));

export function createPickerState(all: readonly XList[]): PickerState {
  const query = signal("");
  const activeIndex = signal(0);
  const results = computed(() => fuzzyRank(query.value, all, (l) => l.name));
  const active = computed<XList | null>(() => results.value[activeIndex.value] ?? null);

  return {
    query,
    results,
    activeIndex,
    active,
    setQuery(q) {
      query.value = q;
      activeIndex.value = 0;
    },
    moveUp() {
      activeIndex.value = clamp(activeIndex.value - 1, results.value.length);
    },
    moveDown() {
      activeIndex.value = clamp(activeIndex.value + 1, results.value.length);
    },
    reset() {
      query.value = "";
      activeIndex.value = 0;
    },
  };
}
