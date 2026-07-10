import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { buildPaletteItems, type PaletteItem } from "@/core/filter-projection";
import type { FilterStore } from "@/core/filter-store";
import { useSignalValue } from "@/ui/use-signal-value";

/**
 * z-index for the palette overlay. Above the funnel pill (2147483640) but below
 * the selection ActionBar (2147483646) so the command surface floats over the
 * passive filter UI without occluding active multi-select (spec §7 / §10).
 */
const PALETTE_Z = 2147483643;

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
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => buildPaletteItems(state).filter((item) => fuzzyMatch(query, item.label)),
    [state, query],
  );

  // Reset the query/highlight each time the palette opens; focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  // Document-level Escape closes the palette even if focus has left the input.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Keep the highlight within the (shrinking) match list.
  useEffect(() => {
    setActive((a) => (matches.length === 0 ? 0 : Math.min(a, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  function run(item: PaletteItem | undefined) {
    if (!item) return;
    cmd(item.run);
    // Stay open for rapid multi-toggle (spec §7).
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (matches.length === 0 ? 0 : (a + 1) % matches.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (matches.length === 0 ? 0 : (a - 1 + matches.length) % matches.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      run(matches[active]);
    }
  }

  return (
    <div
      role="presentation"
      class="bg-scrim fixed inset-0 grid place-items-start justify-center pt-[12vh]"
      style={{ zIndex: PALETTE_Z }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Filter command palette"
        class="bg-card text-card-foreground shadow-elevated w-[28rem] max-w-[92vw] overflow-hidden rounded-2xl"
      >
        <input
          ref={inputRef}
          type="text"
          aria-label="Filter command palette"
          placeholder="Filter timeline… (e.g. only video, reading, show all)"
          value={query}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          class="border-border bg-card text-foreground placeholder:text-faint w-full border-b px-4 py-3 text-sm outline-none"
        />
        <ul role="listbox" class="max-h-[50vh] overflow-y-auto py-1" aria-label="Commands">
          {matches.length === 0 && (
            <li class="text-muted-foreground text-compact px-4 py-2">No matching commands</li>
          )}
          {matches.map((item, i) => (
            <li
              key={item.id}
              role="option"
              tabindex={-1}
              aria-selected={i === active}
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
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
