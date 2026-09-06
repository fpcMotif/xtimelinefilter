/* oxlint-disable jsx-a11y/no-redundant-roles */
// Explicit role keeps the ARIA 1.2 editable-combobox contract visible to assistive tech.
import * as stylex from "@stylexjs/stylex";
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
import { tokens } from "@/ui/tokens.stylex";

import { focusWithoutScroll, scrollIntoViewWithin, useFocusTrap } from "./use-focus-trap";
import { useSignalValue } from "./use-signal-value";

export interface ListPickerProps {
  picker: PickerController;
  onEffect(effect: Exclude<PickerEffect, null>): void;
  onCancel(): void;
  onCreateList(): void;
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
  foreignOwnerBanner: {
    borderColor: "rgba(234, 179, 8, 0.3)",
    backgroundColor: "rgba(234, 179, 8, 0.1)",
    color: tokens.foreground,
    marginLeft: "0.75rem",
    marginRight: "0.75rem",
    marginBottom: "0.5rem",
    borderRadius: tokens.radiusMd,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    fontSize: tokens.textXs,
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
  ownerTabs: {
    display: "flex",
    gap: "0.25rem",
    overflowX: "auto",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingBottom: "0.5rem",
  },
  ownerTabButton: {
    borderColor: tokens.border,
    flexShrink: 0,
    borderRadius: tokens.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontSize: tokens.textXs,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.secondary,
    },
    color: tokens.foreground,
    cursor: "pointer",
    outline: "none",
  },
  ownerTabButtonActive: {
    backgroundColor: tokens.secondary,
  },
  ownerAvatar: {
    backgroundColor: tokens.secondary,
    marginRight: "0.25rem",
    display: "inline-flex",
    height: "1rem",
    width: "1rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radiusFull,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  groupLabel: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.25rem",
    fontWeight: "600",
  },
  row: {
    fontSize: tokens.textMd,
    display: "flex",
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
  rowWritable: {
    cursor: "pointer",
  },
  rowNonWritable: {
    cursor: "not-allowed",
    opacity: 0.65,
  },
  rowName: {
    color: tokens.foreground,
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ownerBadgeWritable: {
    backgroundColor: tokens.secondary,
    color: tokens.mutedForeground,
    borderRadius: tokens.radiusSm,
    paddingLeft: "0.375rem",
    paddingRight: "0.375rem",
    paddingTop: "0.125rem",
    paddingBottom: "0.125rem",
    fontSize: "10px",
  },
  ownerBadgeNonWritable: {
    backgroundColor: "rgba(234, 179, 8, 0.1)",
    color: tokens.foreground,
    borderRadius: tokens.radiusSm,
    paddingLeft: "0.375rem",
    paddingRight: "0.375rem",
    paddingTop: "0.125rem",
    paddingBottom: "0.125rem",
    fontSize: "10px",
  },
  memberCount: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  checkPresentLive: {
    color: tokens.primary,
    fontSize: tokens.textMd,
    flexShrink: 0,
  },
  checkPresentCached: {
    color: tokens.mutedForeground,
    fontSize: tokens.textMd,
    flexShrink: 0,
  },
  lockIcon: {
    color: tokens.mutedForeground,
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
  buttonRow: {
    display: "flex",
    gap: "0.5rem",
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
  ctaButton: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    marginTop: "0.5rem",
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
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
  keycap: {
    fontSize: tokens.text2xs,
    borderRadius: tokens.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(255, 255, 255, 0.4)",
    paddingLeft: "0.25rem",
    paddingRight: "0.25rem",
    lineHeight: "1rem",
    fontFamily: "inherit",
    boxSizing: "border-box",
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
  createOnXButton: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    borderRadius: tokens.radiusFull,
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
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
});

const optionId = (rowKey: string): string => `lasso-list-picker-option-${rowKey}`;

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
    /* v8 ignore start -- view.status is exhaustively loading|ready|empty|error, so this
       last arm always matches when reached; its false branch and the dialogRef?. / ?? null
       fallback are dead. */ else if (view.status === "error")
      focusWithoutScroll(dialogRef.current?.querySelector<HTMLElement>("button") ?? null);
    /* v8 ignore stop */
  }, [view.status]);

  // Do not use scrollIntoView: it may move X's timeline. Only the option scroller
  // moves when keyboard navigation crosses its visible edge.
  useEffect(() => {
    if (!activeRow) return;
    scrollIntoViewWithin(
      listboxRef.current,
      /* v8 ignore next 2 -- the active row is always rendered with aria-selected="true", so the ?? fallback is unreachable */
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
      {...stylex.props(styles.dialog)}
    >
      <header {...stylex.props(styles.header)}>{header}</header>
      {view.status === "loading" && <Skeletons />}
      {view.status === "error" && (
        <ErrorState kind={view.errorKind} onRetry={() => picker.act({ type: "retry" })} />
      )}
      {(view.status === "ready" || view.status === "empty") && (
        <>
          <OwnerTabs view={view} picker={picker} />
          {foreignOwner && (
            <div {...stylex.props(styles.foreignOwnerBanner)}>
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
            {...stylex.props(styles.input)}
          />
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label="Your Lists"
            {...stylex.props(styles.listbox)}
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
          <footer {...stylex.props(styles.footer)}>
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
    <div aria-label="List accounts" {...stylex.props(styles.ownerTabs)}>
      {view.owners.map(({ owner, freshness }) => {
        const isPressed = view.scope.kind === "owner" && view.scope.ownerUserId === owner.userId;
        return (
          <button
            key={owner.userId}
            type="button"
            aria-pressed={isPressed}
            onClick={() =>
              picker.act({
                type: "select-scope",
                scope: { kind: "owner", ownerUserId: owner.userId },
              })
            }
            {...stylex.props(styles.ownerTabButton, isPressed && styles.ownerTabButtonActive)}
          >
            <span aria-hidden="true" {...stylex.props(styles.ownerAvatar)}>
              {owner.screenName.slice(0, 1)}
            </span>
            @{owner.screenName} · {freshnessLabel(freshness)}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={view.scope.kind === "all"}
        onClick={() => picker.act({ type: "select-scope", scope: { kind: "all" } })}
        {...stylex.props(
          styles.ownerTabButton,
          view.scope.kind === "all" && styles.ownerTabButtonActive,
        )}
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
          {group.label && <div {...stylex.props(styles.groupLabel)}>{group.label}</div>}
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
      {...stylex.props(
        styles.row,
        active && styles.rowActive,
        writable ? styles.rowWritable : styles.rowNonWritable,
      )}
    >
      <span {...stylex.props(styles.rowName)}>{row.list.name}</span>
      {allAccounts && row.owner && (
        <span
          {...stylex.props(writable ? styles.ownerBadgeWritable : styles.ownerBadgeNonWritable)}
        >
          {writable ? `@${row.owner.screenName}` : `Switch to @${row.owner.screenName}`}
        </span>
      )}
      {row.list.isPrivate && <LockIcon />}
      {row.list.memberCount !== undefined && (
        <span {...stylex.props(styles.memberCount)}>{memberCountLabel(row.list.memberCount)}</span>
      )}
      {row.membership.kind === "present" && (
        <span
          aria-label="Already in"
          data-membership-source={row.membership.source}
          title={row.membership.source === "x-live" ? "Live from X" : "Cached as of last use"}
          {...stylex.props(
            row.membership.source === "x-live"
              ? styles.checkPresentLive
              : styles.checkPresentCached,
          )}
        >
          ✓
        </span>
      )}
    </div>
  );
}

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
    <div aria-hidden="true" {...stylex.props(styles.skeletons)}>
      {[0, 1, 2].map((index) => (
        <div key={index} data-loading-row {...stylex.props(styles.skeletonRow)} />
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
    <div {...stylex.props(styles.centerContainer)}>
      <p {...stylex.props(styles.errorTitle)}>{PICKER_ERROR_TITLE}</p>
      <p {...stylex.props(styles.errorText)}>{reason}</p>
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
        {...stylex.props(styles.ctaButton)}
      >
        {RETRY}
        <kbd {...stylex.props(styles.keycap)}>R</kbd>
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate(): void }) {
  return (
    <div {...stylex.props(styles.centerContainer)}>
      <p {...stylex.props(styles.errorTitle)}>{EMPTY_TITLE}</p>
      <p {...stylex.props(styles.errorText)}>{EMPTY_BODY}</p>
      <button type="button" onClick={onCreate} {...stylex.props(styles.ctaButton)}>
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
    <div {...stylex.props(styles.centerContainerCompact)}>
      <p {...stylex.props(styles.errorText)}>{noMatchLine(q)}</p>
      <div {...stylex.props(styles.buttonRow)}>
        <button type="button" onClick={onClear} {...stylex.props(styles.clearSearchButton)}>
          {CLEAR_SEARCH}
        </button>
        <button type="button" onClick={onCreate} {...stylex.props(styles.createOnXButton)}>
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
      {...stylex.props(styles.lockIcon)}
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
