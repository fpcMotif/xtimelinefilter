import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { RunningAssign } from "@/content/app-state";
import type { TweetAuthor } from "@/core/selection-store";
import { formatCount, peopleSelected, progressLine, SELECT_MODE_BAR, STOP } from "@/core/strings";
import { UI_LAYER } from "@/ui/layers";
import { focusWithoutScroll } from "@/ui/use-focus-trap";

export interface ActionBarProps {
  authors: TweetAuthor[];
  selectMode: boolean;
  running: RunningAssign | null;
  reviewOpen: boolean;
  /** Decaying Alt+L keycap chips beside the CTA during the onboarding window. */
  hintKeycaps: string[] | null;
  onAssign(): void;
  onClear(): void;
  onDone(): void;
  onStop(): void;
  onRemove(screenName: string): void;
  onToggleReview(open: boolean): void;
  /** Unit tooltip on the count (max 3 ×): resolves to text or null. */
  onCountHover?(): Promise<string | null>;
}

const BAR_CLASS =
  "bg-card shadow-elevated fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2";
const COUNT_TOOLTIP_ID = "lasso-selection-count-tooltip";

/**
 * The floating bar (story beats 4 & 7): facepile · "N people selected" ·
 * Add to List · ✕. In select mode it appears even at zero count; during a run
 * it becomes the progress surface with a Stop pill.
 */
export function ActionBar(props: ActionBarProps) {
  const previousAuthorCount = useRef(props.authors.length);
  const focusDone =
    props.selectMode && props.authors.length === 0 && previousAuthorCount.current > 0;
  useEffect(() => {
    previousAuthorCount.current = props.authors.length;
  }, [props.authors.length]);

  if (props.running) return <ProgressBar running={props.running} onStop={props.onStop} />;
  if (props.authors.length === 0) {
    return props.selectMode ? (
      <SelectModeBar onDone={props.onDone} focusOnMount={focusDone} />
    ) : null;
  }
  return <SelectionBar {...props} />;
}

function ProgressBar({ running, onStop }: { running: RunningAssign; onStop(): void }) {
  const stopRef = useRef<HTMLButtonElement>(null);
  useEffect(() => focusWithoutScroll(stopRef.current), []);

  return (
    <section aria-label="Lasso progress" class={BAR_CLASS} style={{ zIndex: UI_LAYER.app }}>
      <span
        aria-hidden="true"
        class="border-border border-t-primary h-4 w-4 animate-spin rounded-full border-2"
      />
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="text-foreground text-sm tabular-nums"
      >
        {progressLine(running.current, running.total, running.listName)}
      </span>
      <button
        ref={stopRef}
        type="button"
        onClick={onStop}
        class="border-border text-foreground hover:bg-secondary focus-visible:ring-ring/55 rounded-full border px-3 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
      >
        {STOP}
      </button>
    </section>
  );
}

function SelectModeBar({ onDone, focusOnMount }: { onDone(): void; focusOnMount: boolean }) {
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) focusWithoutScroll(doneRef.current);
  }, [focusOnMount]);

  return (
    <section aria-label="Lasso select mode" class={BAR_CLASS} style={{ zIndex: UI_LAYER.app }}>
      <CrosshairGlyph />
      <span class="text-muted-foreground text-sm">{SELECT_MODE_BAR}</span>
      <button
        ref={doneRef}
        type="button"
        onClick={onDone}
        class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/55 rounded-full px-4 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
      >
        Done
      </button>
    </section>
  );
}

function SelectionBar(props: ActionBarProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const hoverGeneration = useRef(0);
  const reviewTriggerRef = useRef<HTMLButtonElement>(null);
  const reviewDialogRef = useRef<HTMLDivElement>(null);
  const wasReviewOpen = useRef(false);
  const pendingReviewFocusIndex = useRef<number | null>(null);
  useEffect(
    () => () => {
      hoverGeneration.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (props.reviewOpen) {
      focusWithoutScroll(
        reviewDialogRef.current?.querySelector<HTMLButtonElement>("button") ?? null,
      );
    } else if (wasReviewOpen.current) {
      focusWithoutScroll(reviewTriggerRef.current);
    }
    wasReviewOpen.current = props.reviewOpen;
  }, [props.reviewOpen]);

  useEffect(() => {
    const requestedIndex = pendingReviewFocusIndex.current;
    if (requestedIndex === null) return;
    pendingReviewFocusIndex.current = null;
    if (!props.reviewOpen) return;
    const buttons = reviewDialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    focusWithoutScroll(buttons[Math.min(requestedIndex, buttons.length - 1)] ?? null);
  }, [props.authors, props.reviewOpen]);

  function removeFromReview(screenName: string, index: number): void {
    pendingReviewFocusIndex.current = index;
    props.onRemove(screenName);
  }

  function onCountEnter() {
    const generation = ++hoverGeneration.current;
    setTooltip(null);
    const request = props.onCountHover?.();
    if (!request) return;
    void request.then(
      (text) => {
        if (hoverGeneration.current === generation) setTooltip(text);
      },
      () => {
        if (hoverGeneration.current === generation) setTooltip(null);
      },
    );
  }

  function onCountLeave() {
    hoverGeneration.current += 1;
    setTooltip(null);
  }

  return (
    <section aria-label="Lasso selection" class={BAR_CLASS} style={{ zIndex: UI_LAYER.app }}>
      {props.reviewOpen && (
        <ReviewPopover
          dialogRef={reviewDialogRef}
          authors={props.authors}
          onRemove={removeFromReview}
        />
      )}
      <button
        ref={reviewTriggerRef}
        type="button"
        aria-label="Review selected people"
        aria-expanded={props.reviewOpen}
        onClick={() => props.onToggleReview(!props.reviewOpen)}
        class="focus-visible:ring-ring/55 flex items-center -space-x-2 rounded-full outline-none focus-visible:ring-2"
      >
        {props.authors.slice(0, 3).map((a) => (
          <Avatar key={a.screenName} author={a} size={24} />
        ))}
        {props.authors.length > 3 && (
          <span class="bg-secondary text-muted-foreground border-card text-2xs z-10 grid h-6 w-6 place-items-center rounded-full border-2 font-semibold tabular-nums">
            +{formatCount(props.authors.length - 3)}
          </span>
        )}
      </button>
      <button
        type="button"
        class="text-muted-foreground relative text-sm tabular-nums"
        aria-describedby={tooltip ? COUNT_TOOLTIP_ID : undefined}
        onMouseEnter={onCountEnter}
        onMouseLeave={onCountLeave}
        onFocus={onCountEnter}
        onBlur={onCountLeave}
      >
        {peopleSelected(props.authors.length)}
        {tooltip && (
          <span
            id={COUNT_TOOLTIP_ID}
            role="tooltip"
            class="bg-foreground text-background shadow-elevated absolute bottom-full left-1/2 z-10 mb-1.5 w-max -translate-x-1/2 rounded-md px-2 py-1 text-xs"
          >
            {tooltip}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={props.onAssign}
        class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/55 flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
      >
        Add to List
        {props.hintKeycaps && (
          <span class="flex items-center gap-0.5">
            {props.hintKeycaps.map((k) => (
              <kbd key={k} class="text-2xs rounded border border-white/40 px-1 leading-4">
                {k}
              </kbd>
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={props.onClear}
        class="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring/55 rounded-full px-2 py-1 text-sm transition-transform duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
      >
        ✕
      </button>
    </section>
  );
}

/** One row per person, each removable before committing (story beat 7). */
function ReviewPopover({
  authors,
  onRemove,
  dialogRef,
}: {
  authors: TweetAuthor[];
  onRemove(screenName: string, index: number): void;
  dialogRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="Selected people"
      class="bg-card shadow-elevated absolute bottom-full left-0 mb-2 max-h-[280px] w-64 overflow-y-auto rounded-2xl p-1"
    >
      {authors.map((a, index) => (
        <div
          key={a.screenName}
          class="hover:bg-secondary flex items-center gap-2 rounded-lg px-2 py-1.5"
        >
          <Avatar author={a} size={28} />
          <span class="text-foreground min-w-0 flex-1 truncate text-sm">@{a.screenName}</span>
          <button
            type="button"
            aria-label={`Remove @${a.screenName}`}
            onClick={() => onRemove(a.screenName, index)}
            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/55 rounded-full px-1.5 outline-none focus-visible:ring-2"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function Avatar({ author, size }: { author: TweetAuthor; size: number }) {
  const dim = `${size}px`;
  if (author.avatarUrl) {
    return (
      <img
        src={author.avatarUrl}
        alt={`@${author.screenName}`}
        width={size}
        height={size}
        class="border-card z-10 rounded-full border-2"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      aria-label={`@${author.screenName}`}
      class="bg-secondary text-muted-foreground border-card text-2xs z-10 grid place-items-center rounded-full border-2 font-semibold uppercase"
      style={{ width: dim, height: dim }}
    >
      {author.screenName.slice(0, 1)}
    </span>
  );
}

function CrosshairGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 20 20"
      class="text-muted-foreground"
    >
      <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M10 1v4M10 15v4M1 10h4M15 10h4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  );
}
