import { useMemo } from "preact/hooks";

import type { XList } from "@/core/x-client/types";

import { createPickerState } from "./picker-state";
import { useSignalValue } from "./use-signal-value";

export interface ListPickerProps {
  lists: readonly XList[];
  onPick: (list: XList) => void;
  onCancel: () => void;
}

/**
 * Keyboard-first, fuzzy List picker (swift UX). No entrance animation — it is a
 * frequently-used, keyboard-driven palette (Emil: never animate keyboard actions).
 */
export function ListPicker({ lists, onPick, onCancel }: ListPickerProps) {
  const picker = useMemo(() => createPickerState(lists), [lists]);
  const query = useSignalValue(picker.query);
  const results = useSignalValue(picker.results);
  const activeIndex = useSignalValue(picker.activeIndex);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      picker.moveDown();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      picker.moveUp();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = picker.active.value;
      if (active) onPick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Add to list"
      class="bg-surface shadow-elevated flex max-h-[360px] w-80 flex-col overflow-hidden rounded-2xl"
    >
      <input
        type="text"
        aria-label="Filter your lists"
        autofocus
        placeholder="Filter your lists…"
        value={query}
        onInput={(e) => picker.setQuery((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
        class="border-line bg-surface text-ink placeholder:text-muted border-0 border-b px-4 py-3 text-[15px] outline-none"
      />
      <div role="listbox" class="overflow-y-auto p-1">
        {results.map((list, i) => (
          <div
            key={list.id}
            role="option"
            tabindex={-1}
            aria-selected={i === activeIndex}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(list);
            }}
            class={`cursor-pointer rounded-lg px-3 py-2.5 text-[15px] ${
              i === activeIndex ? "bg-elevated" : ""
            }`}
          >
            {list.name}
          </div>
        ))}
        {results.length === 0 && (
          <div class="text-muted px-3 py-2.5 text-[15px]">No matching lists</div>
        )}
      </div>
    </div>
  );
}
