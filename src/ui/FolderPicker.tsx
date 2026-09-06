/* oxlint-disable jsx-a11y/no-redundant-roles */
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "preact/hooks";

import type {
  FolderPickerController,
  FolderPickerEffect,
  FolderPickerRow,
  FolderPickerView,
} from "@/core/folder-picker-controller";
import {
  CLEAR_SEARCH,
  FOLDER_PICKER_EMPTY_BODY,
  FOLDER_PICKER_EMPTY_TITLE,
  FOLDER_PICKER_ERROR_TITLE,
  FOLDER_PICKER_ERROR_UNKNOWN,
  FOLDER_PICKER_FOOTER,
  FOLDER_PICKER_HOLDING_LABEL,
  FOLDER_PICKER_LIST_LABEL,
  FOLDER_PICKER_NO_MATCH,
  FOLDER_PICKER_SEARCH,
  FOLDER_PICKER_TITLE,
  RETRY,
} from "@/core/strings";
import { tokens } from "@/ui/tokens.stylex";

import { focusWithoutScroll, scrollIntoViewWithin, useFocusTrap } from "./use-focus-trap";
import { useSignalValue } from "./use-signal-value";
export interface FolderPickerProps {
  picker: FolderPickerController;
  onEffect(effect: Exclude<FolderPickerEffect, null>): void;
  onCancel(): void;
}

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.5 },
});

const styles = stylex.create({
  dialog: {
    backgroundColor: tokens.card,
    boxShadow: tokens.shadowElevated,
    display: "flex",
    maxHeight: "460px",
    width: "20rem",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: tokens.radiusXl,
    boxSizing: "border-box",
  },
  header: {
    color: tokens.foreground,
    fontSize: tokens.textMd,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.75rem",
    paddingBottom: "0.5rem",
    fontWeight: "700",
  },
  centerContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "1.5rem",
    paddingBottom: "1.5rem",
    textAlign: "center",
  },
  centerContainerCompact: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "1.25rem",
    paddingBottom: "1.25rem",
    textAlign: "center",
  },
  errorTitle: {
    color: tokens.foreground,
    fontSize: tokens.textMd,
    fontWeight: "700",
    margin: 0,
  },
  errorText: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    margin: 0,
  },
  retryButton: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    marginTop: "0.5rem",
    borderRadius: tokens.radiusFull,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    fontSize: tokens.textSm,
    fontWeight: "600",
    outline: "none",
    borderWidth: 0,
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
  input: {
    borderWidth: 0,
    borderBottomWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    fontSize: tokens.textMd,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.75rem",
    paddingBottom: "0.75rem",
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
    "::placeholder": {
      color: tokens.faint,
    },
  },
  listbox: {
    minHeight: 0,
    flex: 1,
    overflowY: "auto",
    padding: "0.25rem",
  },
  clearSearchButton: {
    borderColor: tokens.border,
    color: tokens.foreground,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.secondary,
    },
    borderRadius: tokens.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    fontSize: tokens.textSm,
    fontWeight: "600",
    outline: "none",
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
  footer: {
    borderColor: tokens.border,
    color: tokens.mutedForeground,
    borderTopWidth: "1px",
    borderStyle: "solid",
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    fontSize: tokens.textXs,
    fontVariantNumeric: "tabular-nums",
  },
  row: {
    fontSize: tokens.textMd,
    display: "flex",
    cursor: "pointer",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: tokens.radiusLg,
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.625rem",
    paddingBottom: "0.625rem",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.secondary,
    },
  },
  rowActive: {
    backgroundColor: tokens.secondary,
  },
  rowName: {
    color: tokens.foreground,
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowHolding: {
    color: tokens.primary,
    fontSize: tokens.textMd,
    flexShrink: 0,
  },
  skeletons: {
    padding: "0.75rem",
  },
  skeletonRow: {
    backgroundColor: tokens.secondary,
    marginBottom: "0.5rem",
    height: "2.25rem",
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite",
    borderRadius: tokens.radiusLg,
  },
});

const optionId = (rowKey: string): string => `lasso-folder-picker-option-${rowKey}`;

/** Folder Picker UI. Folders are account-free, so there are no owner tabs. */
export function FolderPicker({ picker, onEffect, onCancel }: FolderPickerProps) {
  const view = useSignalValue(picker.view);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const activeRow = view.active;
  useFocusTrap(dialogRef);

  useEffect(() => {
    if (view.status === "loading") focusWithoutScroll(dialogRef.current);
    else if (view.status === "ready" || view.status === "empty")
      focusWithoutScroll(inputRef.current);
    /* v8 ignore start -- view.status is exhaustively loading|ready|empty|error, so this
       last arm always matches when reached; its false branch and the dialogRef?. / ?? null
       fallback are dead. */ else if (view.status === "error")
      focusWithoutScroll(dialogRef.current?.querySelector<HTMLElement>("button") ?? null);
    /* v8 ignore stop */
  }, [view.status]);

  useEffect(() => {
    if (!activeRow) return;
    scrollIntoViewWithin(
      listboxRef.current,
      /* v8 ignore next 2 -- the active row is always rendered with aria-selected="true", so the ?? fallback is unreachable */
      listboxRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
        null,
    );
  }, [activeRow]);

  const listboxId = "lasso-folder-picker-options";
  const choose = (rowKey: string): void => {
    const effect = picker.act({ type: "choose", rowKey });
    if (effect) onEffect(effect);
  };
  const cancel = (): void => {
    picker.act({ type: "close" });
    onCancel();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      picker.act({
        type: "move",
        direction: event.key === "ArrowDown" ? "down" : "up",
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (view.active) choose(view.active.key);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={FOLDER_PICKER_TITLE}
      tabindex={-1}
      {...stylex.props(styles.dialog)}
    >
      <header {...stylex.props(styles.header)}>{FOLDER_PICKER_TITLE}</header>
      {view.status === "loading" && <Skeletons />}
      {view.status === "error" && (
        <div {...stylex.props(styles.centerContainer)}>
          <p {...stylex.props(styles.errorTitle)}>{FOLDER_PICKER_ERROR_TITLE}</p>
          <p {...stylex.props(styles.errorText)}>{FOLDER_PICKER_ERROR_UNKNOWN}</p>
          <button
            type="button"
            onClick={() => picker.act({ type: "retry" })}
            {...stylex.props(styles.retryButton)}
          >
            {RETRY}
          </button>
        </div>
      )}
      {(view.status === "ready" || view.status === "empty") && (
        <>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={FOLDER_PICKER_SEARCH}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={view.status === "ready" || view.status === "empty"}
            aria-activedescendant={view.active ? optionId(view.active.key) : undefined}
            placeholder={FOLDER_PICKER_SEARCH}
            value={view.query}
            onInput={(event) =>
              picker.act({
                type: "query",
                value: (event.currentTarget as HTMLInputElement).value,
              })
            }
            onKeyDown={onKeyDown}
            {...stylex.props(styles.input)}
          />
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={FOLDER_PICKER_LIST_LABEL}
            {...stylex.props(styles.listbox)}
          >
            {view.status === "empty" && !view.noMatch && <EmptyState />}
            {view.status === "ready" && !view.noMatch && <Rows view={view} onChoose={choose} />}
            {view.noMatch && (
              <div {...stylex.props(styles.centerContainerCompact)}>
                <p {...stylex.props(styles.errorText)}>{FOLDER_PICKER_NO_MATCH(view.query)}</p>
                <button
                  type="button"
                  onClick={() => picker.act({ type: "query", value: "" })}
                  {...stylex.props(styles.clearSearchButton)}
                >
                  {CLEAR_SEARCH}
                </button>
              </div>
            )}
          </div>
          <footer {...stylex.props(styles.footer)}>{FOLDER_PICKER_FOOTER}</footer>
        </>
      )}
    </div>
  );
}

function Rows({ view, onChoose }: { view: FolderPickerView; onChoose(rowKey: string): void }) {
  return (
    <>
      {view.rows.map((row, index) => (
        <Row key={row.key} row={row} active={index === view.activeIndex} onChoose={onChoose} />
      ))}
    </>
  );
}

function Row({
  row,
  active,
  onChoose,
}: {
  row: FolderPickerRow;
  active: boolean;
  onChoose(rowKey: string): void;
}) {
  return (
    <div
      id={optionId(row.key)}
      role="option"
      tabindex={-1}
      aria-selected={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChoose(row.key)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        onChoose(row.key);
      }}
      {...stylex.props(styles.row, active && styles.rowActive)}
    >
      <span {...stylex.props(styles.rowName)}>{row.folder.name}</span>
      {row.holding && (
        <span aria-label={FOLDER_PICKER_HOLDING_LABEL} {...stylex.props(styles.rowHolding)}>
          ✓
        </span>
      )}
    </div>
  );
}

function Skeletons() {
  return (
    <div aria-hidden="true" {...stylex.props(styles.skeletons)}>
      {[0, 1, 2].map((index) => (
        <div key={index} data-loading-row {...stylex.props(styles.skeletonRow)} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div {...stylex.props(styles.centerContainer)}>
      <p {...stylex.props(styles.errorTitle)}>{FOLDER_PICKER_EMPTY_TITLE}</p>
      <p {...stylex.props(styles.errorText)}>{FOLDER_PICKER_EMPTY_BODY}</p>
    </div>
  );
}
