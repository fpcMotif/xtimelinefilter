/* oxlint-disable jsx-a11y/no-redundant-roles */
// Explicit role keeps the ARIA 1.2 editable-combobox contract visible to assistive tech.
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { buildPaletteItems, type PaletteItem } from "@/core/filter-projection";
import type { FilterStore } from "@/core/filter-store";
import { UI_LAYER } from "@/ui/layers";
import { tokens } from "@/ui/tokens.stylex";
import { focusWithoutScroll, scrollIntoViewWithin, useFocusTrap } from "@/ui/use-focus-trap";
import { useSignalValue } from "@/ui/use-signal-value";

const styles = stylex.create({
  scrim: {
    backgroundColor: tokens.scrim,
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "start",
    justifyContent: "center",
    paddingTop: "12vh",
  },
  dialog: {
    backgroundColor: tokens.card,
    color: tokens.cardForeground,
    boxShadow: tokens.shadowElevated,
    width: "28rem",
    maxWidth: "92vw",
    overflow: "hidden",
    borderRadius: tokens.radiusXl,
    boxSizing: "border-box",
  },
  input: {
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    width: "100%",
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.75rem",
    paddingBottom: "0.75rem",
    fontSize: tokens.textSm,
    outline: "none",
    boxSizing: "border-box",
    "::placeholder": {
      color: tokens.faint,
    },
  },
  listbox: {
    maxHeight: "50vh",
    overflowY: "auto",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    listStyleType: "none",
    paddingLeft: 0,
    margin: 0,
  },
  empty: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
  },
  item: {
    fontSize: tokens.textCompact,
    cursor: "pointer",
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    backgroundColor: {
      default: "transparent",
    },
    color: tokens.foreground,
  },
  itemActive: {
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
});

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
      {...stylex.props(styles.scrim)}
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
        {...stylex.props(styles.dialog)}
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
          {...stylex.props(styles.input)}
        />
        <ul
          ref={listboxRef}
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Commands"
          {...stylex.props(styles.listbox)}
        >
          {matches.length === 0 && <li {...stylex.props(styles.empty)}>No matching commands</li>}
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
              {...stylex.props(styles.item, i === active && styles.itemActive)}
            >
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
