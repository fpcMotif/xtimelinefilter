/* oxlint-disable jsx-a11y/no-redundant-roles */
// Explicit role keeps the ARIA 1.2 editable-combobox contract visible to assistive tech.
import { useEffect, useRef } from "preact/hooks";

import type {
  PickerController,
  PickerEffect,
  PickerErrorKind,
  PickerRow,
  PickerView,
} from "@/core/picker-controller";
import {
  CLEAR_SEARCH,
  createOnX,
  EMPTY_BODY,
  EMPTY_CTA,
  EMPTY_TITLE,
  memberCountLabel,
  noMatchLine,
  PICKER_ERROR_LOGGED_OUT,
  PICKER_ERROR_RATE_LIMITED,
  PICKER_ERROR_TITLE,
  PICKER_ERROR_UNKNOWN,
  pickerFooterLegend,
  pickerHeader,
  RETRY,
  SEARCH_PLACEHOLDER,
} from "@/core/strings";

import { focusWithoutScroll, scrollIntoViewWithin, useFocusTrap } from "./use-focus-trap";
import { useSignalValue } from "./use-signal-value";

export interface ListPickerProps {
  picker: PickerController;
  onEffect(effect: Exclude<PickerEffect, null>): void;
  onCancel(): void;
  onCreateList(): void;
}

/** Atomic picker UI. Raw Lists never bypass the Owner guard. */
export function ListPicker({ picker, onEffect, onCancel, onCreateList }: ListPickerProps) {
  const view = useSignalValue(picker.view);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const activeRow = view.active;
  useFocusTrap(dialogRef);

  // Opening starts at search, even when a pending X request rendered the dialog
  // before its editable combobox existed.
  useEffect(() => {
    if (view.status === "loading") focusWithoutScroll(dialogRef.current);
    else if (view.status === "ready" || view.status === "empty")
      focusWithoutScroll(inputRef.current);
    else if (view.status === "error")
      focusWithoutScroll(dialogRef.current?.querySelector<HTMLElement>("button") ?? null);
  }, [view.status]);

  // Do not use scrollIntoView: it may move X's timeline. Only the option scroller
  // moves when keyboard navigation crosses its visible edge.
  useEffect(() => {
    if (!activeRow) return;
    scrollIntoViewWithin(
      listboxRef.current,
      listboxRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
        null,
    );
  }, [activeRow]);

  const header = pickerHeader(view.authors);
  const listboxId = "lasso-list-picker-options";
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

  const selectedScope = view.scope;
  const selectedOwner =
    selectedScope.kind === "owner"
      ? view.owners.find((tab) => tab.owner.userId === selectedScope.ownerUserId)
      : undefined;
  const foreignOwner = selectedOwner?.freshness.kind === "cached" ? selectedOwner.owner : null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={header}
      tabindex={-1}
      class="bg-card shadow-elevated flex max-h-[460px] w-80 flex-col overflow-hidden rounded-2xl"
    >
      <header class="text-foreground text-md px-4 pt-3 pb-2 font-bold">{header}</header>
      {view.status === "loading" && <Skeletons />}
      {view.status === "error" && (
        <ErrorState kind={view.errorKind} onRetry={() => picker.act({ type: "retry" })} />
      )}
      {(view.status === "ready" || view.status === "empty") && (
        <>
          <OwnerTabs view={view} picker={picker} />
          {foreignOwner && (
            <div class="border-warning/30 bg-warning/10 text-warning-foreground mx-3 mb-2 rounded-lg border px-3 py-2 text-xs">
              Switch to @{foreignOwner.screenName} on X to add here
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={SEARCH_PLACEHOLDER}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={view.status === "ready" || view.status === "empty"}
            aria-activedescendant={view.active ? optionId(view.active.key) : undefined}
            placeholder={SEARCH_PLACEHOLDER}
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
            aria-label="Your Lists"
            class="min-h-0 flex-1 overflow-y-auto p-1"
          >
            {view.status === "empty" && !view.noMatch && <EmptyState onCreate={onCreateList} />}
            {view.status === "ready" && !view.noMatch && (
              <GroupedRows view={view} onChoose={choose} />
            )}
            {view.noMatch && (
              <NoMatch
                query={view.query}
                onClear={() => picker.act({ type: "query", value: "" })}
                onCreate={onCreateList}
              />
            )}
          </div>
          <footer class="border-border text-muted-foreground border-t px-4 py-2 text-xs tabular-nums">
            {pickerFooterLegend(view.authors.length)}
          </footer>
        </>
      )}
    </div>
  );
}

function OwnerTabs({ view, picker }: { view: PickerView; picker: PickerController }) {
  if (view.owners.length < 2) return null;
  return (
    <div aria-label="List accounts" class="flex gap-1 overflow-x-auto px-3 pb-2">
      {view.owners.map(({ owner, freshness }) => (
        <button
          key={owner.userId}
          type="button"
          aria-pressed={view.scope.kind === "owner" && view.scope.ownerUserId === owner.userId}
          onClick={() =>
            picker.act({
              type: "select-scope",
              scope: { kind: "owner", ownerUserId: owner.userId },
            })
          }
          class="border-border aria-pressed:bg-secondary shrink-0 rounded-full border px-2 py-1 text-xs"
        >
          <span
            aria-hidden="true"
            class="bg-secondary mr-1 inline-flex size-4 items-center justify-center rounded-full font-bold uppercase"
          >
            {owner.screenName.slice(0, 1)}
          </span>
          @{owner.screenName} · {freshnessLabel(freshness)}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={view.scope.kind === "all"}
        onClick={() => picker.act({ type: "select-scope", scope: { kind: "all" } })}
        class="border-border aria-pressed:bg-secondary shrink-0 rounded-full border px-2 py-1 text-xs"
      >
        All accounts
      </button>
    </div>
  );
}

function GroupedRows({ view, onChoose }: { view: PickerView; onChoose(rowKey: string): void }) {
  let flatIndex = -1;
  return (
    <>
      {view.groups.map((group, groupIndex) => (
        <div key={`${group.label ?? "all"}:${groupIndex}`}>
          {group.label && (
            <div class="text-muted-foreground text-compact px-3 pt-2 pb-1 font-semibold">
              {group.label}
            </div>
          )}
          {group.rows.map((row) => {
            flatIndex++;
            return (
              <Row
                key={row.key}
                row={row}
                allAccounts={view.scope.kind === "all"}
                active={flatIndex === view.activeIndex}
                onChoose={onChoose}
              />
            );
          })}
        </div>
      ))}
    </>
  );
}

function Row({
  row,
  active,
  allAccounts,
  onChoose,
}: {
  row: PickerRow;
  active: boolean;
  allAccounts: boolean;
  onChoose(rowKey: string): void;
}) {
  const writable = row.access.kind === "writable";
  const choose = (): void => {
    if (writable) onChoose(row.key);
  };
  return (
    <div
      id={optionId(row.key)}
      role="option"
      tabindex={-1}
      aria-selected={active}
      aria-disabled={!writable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        choose();
      }}
      class={`text-md flex items-center gap-2 rounded-lg px-3 py-2.5 ${
        active ? "bg-secondary" : ""
      } ${writable ? "cursor-pointer" : "cursor-not-allowed opacity-65"}`}
    >
      <span class="text-foreground min-w-0 flex-1 truncate">{row.list.name}</span>
      {allAccounts && row.owner && (
        <span
          class={`${writable ? "bg-secondary text-muted-foreground" : "bg-warning/10 text-warning-foreground"} rounded px-1.5 py-0.5 text-[10px]`}
        >
          {writable ? `@${row.owner.screenName}` : `Switch to @${row.owner.screenName}`}
        </span>
      )}
      {row.list.isPrivate && <LockIcon />}
      {row.list.memberCount !== undefined && (
        <span class="text-muted-foreground text-compact shrink-0 tabular-nums">
          {memberCountLabel(row.list.memberCount)}
        </span>
      )}
      {row.membership.kind === "present" && (
        <span
          aria-label="Already in"
          data-membership-source={row.membership.source}
          title={row.membership.source === "x-live" ? "Live from X" : "Cached as of last use"}
          class={`${row.membership.source === "x-live" ? "text-primary" : "text-muted-foreground"} text-md shrink-0`}
        >
          ✓
        </span>
      )}
    </div>
  );
}

const optionId = (rowKey: string): string => `lasso-list-picker-option-${rowKey}`;

export function freshnessLabel(
  freshness: PickerView["owners"][number]["freshness"],
  now = Date.now(),
): string {
  if (freshness.kind === "active") return "active";
  if (freshness.asOf === undefined) return "as of last use";
  const days = Math.max(0, Math.floor((now - freshness.asOf) / 86_400_000));
  if (days === 0) return "as of today";
  return `as of ${days}d ago`;
}

function Skeletons() {
  return (
    <div aria-hidden="true" class="p-3">
      {[0, 1, 2].map((index) => (
        <div key={index} data-loading-row class="bg-secondary mb-2 h-9 animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

function ErrorState({ kind, onRetry }: { kind: PickerErrorKind; onRetry(): void }) {
  const reason =
    kind === "rate-limited"
      ? PICKER_ERROR_RATE_LIMITED
      : kind === "auth"
        ? PICKER_ERROR_LOGGED_OUT
        : PICKER_ERROR_UNKNOWN;
  return (
    <div class="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p class="text-foreground text-md font-bold">{PICKER_ERROR_TITLE}</p>
      <p class="text-muted-foreground text-compact">{reason}</p>
      <button
        type="button"
        onClick={onRetry}
        onKeyDown={(event) => {
          if (event.key === "r") {
            event.preventDefault();
            event.stopPropagation();
            onRetry();
          }
        }}
        class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/55 mt-2 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2"
      >
        {RETRY}
        <kbd class="text-2xs rounded border border-white/40 px-1 leading-4">R</kbd>
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate(): void }) {
  return (
    <div class="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <p class="text-foreground text-md font-bold">{EMPTY_TITLE}</p>
      <p class="text-muted-foreground text-compact">{EMPTY_BODY}</p>
      <button
        type="button"
        onClick={onCreate}
        class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/55 mt-2 rounded-full px-4 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2"
      >
        {EMPTY_CTA}
      </button>
    </div>
  );
}

function NoMatch({
  query,
  onClear,
  onCreate,
}: {
  query: string;
  onClear(): void;
  onCreate(): void;
}) {
  const q = query.trim();
  return (
    <div class="flex flex-col items-center gap-2 px-4 py-5 text-center">
      <p class="text-muted-foreground text-md">{noMatchLine(q)}</p>
      <div class="flex gap-2">
        <button
          type="button"
          onClick={onClear}
          class="border-border text-foreground hover:bg-secondary focus-visible:ring-ring/55 rounded-full border px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {CLEAR_SEARCH}
        </button>
        <button
          type="button"
          onClick={onCreate}
          class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/55 rounded-full px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {createOnX(q)}
        </button>
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      aria-label="Private"
      role="img"
      width="13"
      height="13"
      viewBox="0 0 20 20"
      class="text-muted-foreground shrink-0"
    >
      <path
        d="M6 9V6.5a4 4 0 1 1 8 0V9m-9 0h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  );
}
