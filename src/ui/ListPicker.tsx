import type { PickerController } from "@/core/picker-controller";
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
  RETRY,
  SEARCH_PLACEHOLDER,
} from "@/core/strings";
import type { XList } from "@/core/x-client/types";

import { useSignalValue } from "./use-signal-value";

export interface ListPickerProps {
  picker: PickerController;
  /** "Add @jane to a List" / "Add 3 people to a List" (canonical string 1). */
  header: string;
  selectedCount: number;
  onPick(list: XList): void;
  onCancel(): void;
  /** Opens x.com/i/lists/create — every dead end becomes a creation path. */
  onCreateList(): void;
}

/**
 * The List picker with its five designed states (story beats 4 & 8): loading
 * skeletons / error / empty / no-match / ready. Keyboard-first: ↑↓ Navigate ·
 * Enter Add · Esc Dismiss · r Retry. No entrance animation — it is a
 * keyboard-driven palette.
 */
export function ListPicker({
  picker,
  header,
  selectedCount,
  onPick,
  onCancel,
  onCreateList,
}: ListPickerProps) {
  const status = useSignalValue(picker.status);
  const errorKind = useSignalValue(picker.errorKind);
  const query = useSignalValue(picker.query);
  const groups = useSignalValue(picker.groups);
  const activeIndex = useSignalValue(picker.activeIndex);
  const alreadyIn = useSignalValue(picker.alreadyIn);
  const noMatch = useSignalValue(picker.noMatch);

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
      aria-label={header}
      class="bg-card shadow-elevated flex max-h-[420px] w-80 flex-col overflow-hidden rounded-2xl"
    >
      <header class="text-foreground text-md px-4 pt-3 pb-1 font-bold">{header}</header>

      {status === "loading" && <Skeletons />}
      {status === "error" && (
        <ErrorState kind={errorKind} onRetry={() => void picker.retry()} onCancel={onCancel} />
      )}
      {status === "empty" && <EmptyState onCreate={onCreateList} />}

      {status === "ready" && (
        <>
          <input
            type="text"
            aria-label={SEARCH_PLACEHOLDER}
            autofocus
            placeholder={SEARCH_PLACEHOLDER}
            value={query}
            onInput={(e) => picker.setQuery((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            class="border-border bg-card text-foreground placeholder:text-faint text-md border-0 border-b px-4 py-3 outline-none"
          />
          <div role="listbox" aria-label="Your Lists" class="min-h-0 flex-1 overflow-y-auto p-1">
            {!noMatch && <GroupedRows {...{ groups, activeIndex, alreadyIn, onPick }} />}
            {noMatch && (
              <NoMatch query={query} onClear={() => picker.setQuery("")} onCreate={onCreateList} />
            )}
          </div>
          <footer class="border-border text-muted-foreground border-t px-4 py-2 text-xs tabular-nums">
            {pickerFooterLegend(selectedCount)}
          </footer>
        </>
      )}
    </div>
  );
}

function GroupedRows({
  groups,
  activeIndex,
  alreadyIn,
  onPick,
}: {
  groups: ReturnType<PickerController["groups"]["peek"]>;
  activeIndex: number;
  alreadyIn: ReadonlySet<string>;
  onPick(list: XList): void;
}) {
  let flatIndex = -1;
  return (
    <>
      {groups.map((group) => (
        <div key={group.label ?? "all"}>
          {group.label && (
            <div class="text-muted-foreground text-compact px-3 pt-2 pb-1 font-semibold">
              {group.label}
            </div>
          )}
          {group.rows.map((list) => {
            flatIndex++;
            return (
              <Row
                key={list.id}
                list={list}
                active={flatIndex === activeIndex}
                alreadyIn={alreadyIn.has(list.id)}
                onPick={onPick}
              />
            );
          })}
        </div>
      ))}
    </>
  );
}

function Row({
  list,
  active,
  alreadyIn,
  onPick,
}: {
  list: XList;
  active: boolean;
  alreadyIn: boolean;
  onPick(list: XList): void;
}) {
  return (
    <div
      role="option"
      tabindex={-1}
      aria-selected={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick(list);
      }}
      class={`text-md flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 ${
        active ? "bg-secondary" : ""
      }`}
    >
      <span class="text-foreground min-w-0 flex-1 truncate">{list.name}</span>
      {list.isPrivate && <LockIcon />}
      {list.memberCount !== undefined && (
        <span class="text-muted-foreground text-compact shrink-0 tabular-nums">
          {memberCountLabel(list.memberCount)}
        </span>
      )}
      {alreadyIn && (
        <span aria-label="Already in" class="text-primary text-md shrink-0">
          ✓
        </span>
      )}
    </div>
  );
}

function Skeletons() {
  return (
    <div aria-hidden="true" class="p-3">
      {[0, 1, 2].map((i) => (
        <div key={i} data-loading-row class="bg-secondary mb-2 h-9 animate-pulse rounded-lg" />
      ))}
    </div>
  );
}

function ErrorState({
  kind,
  onRetry,
  onCancel,
}: {
  kind: string;
  onRetry(): void;
  onCancel(): void;
}) {
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
        autofocus
        onClick={onRetry}
        onKeyDown={(e) => {
          // "pressing r retries from the keyboard" (story beat 8)
          if (e.key === "r") {
            e.preventDefault();
            onRetry();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
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
