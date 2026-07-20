/* oxlint-disable jsx-a11y/no-redundant-roles */
// Explicit role keeps the ARIA 1.2 editable-combobox contract visible to assistive tech.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { buildPaletteItems, type PaletteItem } from "@/core/filter-projection";
import type { FilterStore } from "@/core/filter-store";
import { UI_LAYER } from "@/ui/layers";
import { focusWithoutScroll, scrollIntoViewWithin, useFocusTrap } from "@/ui/use-focus-trap";
import { useSignalValue } from "@/ui/use-signal-value";

const LISTBOX_ID = "lasso-filter-palette-options";

function optionId(item: PaletteItem): string {
  return `lasso-filter-palette-option-${item.id}`;
}

function activeOption(
  listbox: HTMLUListElement | null,
  item: PaletteItem | undefined,
): HTMLElement | null {
  if (!listbox || !item) return null;
  /* v8 ignore next 5 -- unreachable: matches[active] always renders an option li, so find() never misses */
  return (
    [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.id === optionId(item),
    ) ?? null
  );
}

/**
 * Subsequence fuzzy match: every character of `query` (ignoring case and spaces)
 * must appear in order within `label`. Empty query matches everything.
 */
function fuzzyMatch(query: string, label: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  const hay = label.toLowerCase();
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i += 1;
    if (i === q.length) return true;
  }
  return i === q.length;
}

export interface FilterPaletteProps {
  store: FilterStore;
  open: boolean;
  onClose: () => void;
  /**
   * Conduct each invoked item through the controller's fail-open wall (the palette
   * is the in-page command surface). Omit ⇒ items run directly on the store.
   */
  conduct?: (run: (s: FilterStore) => void) => void;
}

/**
 * Command palette overlay (spec §7): a centered card with a search input and a
 * fuzzy-filtered list spanning the criteria, saved presets, and global actions.
 * Up/Down move the highlight, Enter runs the highlighted item and keeps the
 * palette open for rapid multi-toggle, and Escape / outside-click closes it.
 * Honors the host's `data-hc` (styling lives in styles.css) and never sets
 * innerHTML from page data (ADR-0003) — labels are static catalog strings.
 */
export function FilterPalette({
  store,
  open,
  onClose,
  conduct,
}: FilterPaletteProps): preact.JSX.Element | null {
  const cmd = conduct ?? ((exec: (s: FilterStore) => void) => exec(store));
  const state = useSignalValue(store.state);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  useFocusTrap(dialogRef, open);

  const matches = useMemo(
    () => buildPaletteItems(state).filter((item) => fuzzyMatch(query, item.label)),
    [state, query],
  );

  // Reset the query/highlight each time the palette opens; focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    focusWithoutScroll(inputRef.current);
  }, [open]);

  // Keep the highlight within the (shrinking) match list.
  useEffect(() => {
    setActive((a) => (matches.length === 0 ? 0 : Math.min(a, matches.length - 1)));
  }, [matches.length]);

  // Keep the highlighted command visible without scrolling the host timeline.
  useEffect(() => {
    const item = matches[active];
    scrollIntoViewWithin(listboxRef.current, activeOption(listboxRef.current, item));
  }, [active, matches]);

  if (!open) return null;

  function run(item: PaletteItem | undefined) {
    if (!item) return;
    cmd(item.run);
    // Stay open for rapid multi-toggle (spec §7).
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActive((a) => (matches.length === 0 ? 0 : (a + 1) % matches.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActive((a) => (matches.length === 0 ? 0 : (a - 1 + matches.length) % matches.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      run(matches[active]);
    }
  }

  return (
    <div
      role="presentation"
      class="bg-scrim fixed inset-0 grid place-items-start justify-center pt-[12vh]"
      style={{ zIndex: UI_LAYER.modal }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filter command palette"
        class="bg-card text-card-foreground shadow-elevated w-[28rem] max-w-[92vw] overflow-hidden rounded-2xl"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Filter command palette"
          aria-autocomplete="list"
          aria-controls={LISTBOX_ID}
          aria-expanded={true}
          aria-activedescendant={matches[active] ? optionId(matches[active]!) : undefined}
          placeholder="Filter timeline… (e.g. only video, reading, show all)"
          value={query}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          class="border-border bg-card text-foreground placeholder:text-faint w-full border-b px-4 py-3 text-sm outline-none"
        />
        <ul
          ref={listboxRef}
          id={LISTBOX_ID}
          role="listbox"
          class="max-h-[50vh] overflow-y-auto py-1"
          aria-label="Commands"
        >
          {matches.length === 0 && (
            <li class="text-muted-foreground text-compact px-4 py-2">No matching commands</li>
          )}
          {matches.map((item, i) => (
            <li
              key={item.id}
              id={optionId(item)}
              role="option"
              tabindex={-1}
              aria-selected={i === active}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(item)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                run(item);
              }}
              class={`text-compact cursor-pointer px-4 py-2 ${
                i === active ? "bg-primary text-primary-foreground" : "text-foreground"
              }`}
            >
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
