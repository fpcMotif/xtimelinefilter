/* oxlint-disable jsx-a11y/no-redundant-roles */
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

import { focusWithoutScroll, scrollIntoViewWithin, useFocusTrap } from "./use-focus-trap";
import { useSignalValue } from "./use-signal-value";

export interface FolderPickerProps {
  picker: FolderPickerController;
  onEffect(effect: Exclude<FolderPickerEffect, null>): void;
  onCancel(): void;
}

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
      class="bg-card shadow-elevated flex max-h-[460px] w-80 flex-col overflow-hidden rounded-2xl"
    >
      <header class="text-foreground text-md px-4 pt-3 pb-2 font-bold">
        {FOLDER_PICKER_TITLE}
      </header>
      {view.status === "loading" && <Skeletons />}
      {view.status === "error" && (
        <div class="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p class="text-foreground text-md font-bold">{FOLDER_PICKER_ERROR_TITLE}</p>
          <p class="text-muted-foreground text-compact">{FOLDER_PICKER_ERROR_UNKNOWN}</p>
          <button
            type="button"
            onClick={() => picker.act({ type: "retry" })}
            class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/55 mt-2 rounded-full px-4 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2"
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
            class="border-border bg-card text-foreground placeholder:text-faint text-md border-0 border-b px-4 py-3 outline-none"
          />
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={FOLDER_PICKER_LIST_LABEL}
            class="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {view.status === "empty" && !view.noMatch && <EmptyState />}
            {view.status === "ready" && !view.noMatch && <Rows view={view} onChoose={choose} />}
            {view.noMatch && (
              <div class="flex flex-col items-center gap-2 px-4 py-5 text-center">
                <p class="text-muted-foreground text-md">{FOLDER_PICKER_NO_MATCH(view.query)}</p>
                <button
                  type="button"
                  onClick={() => picker.act({ type: "query", value: "" })}
                  class="border-border text-foreground hover:bg-secondary focus-visible:ring-ring/55 rounded-full border px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2"
                >
                  {CLEAR_SEARCH}
                </button>
              </div>
            )}
          </div>
          <footer class="border-border text-muted-foreground border-t px-4 py-2 text-xs tabular-nums">
            {FOLDER_PICKER_FOOTER}
          </footer>
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
      class={`text-md flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 ${
        active ? "bg-secondary" : ""
      }`}
    >
      <span class="text-foreground min-w-0 flex-1 truncate">{row.folder.name}</span>
      {row.holding && (
        <span aria-label={FOLDER_PICKER_HOLDING_LABEL} class="text-primary text-md shrink-0">
          ✓
        </span>
      )}
    </div>
  );
}

const optionId = (rowKey: string): string => `lasso-folder-picker-option-${rowKey}`;

function Skeletons() {
  return (
    <div aria-hidden="true" class="p-3">
      {[0, 1, 2].map((index) => (
        <div key={index} data-loading-row class="bg-secondary mb-2 h-9 animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div class="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p class="text-foreground text-md font-bold">{FOLDER_PICKER_EMPTY_TITLE}</p>
      <p class="text-muted-foreground text-compact">{FOLDER_PICKER_EMPTY_BODY}</p>
    </div>
  );
}
