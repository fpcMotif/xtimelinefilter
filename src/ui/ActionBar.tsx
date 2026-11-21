import * as stylex from "@stylexjs/stylex";
import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { RunningAssign } from "@/content/app-state";
import type { TweetAuthor } from "@/core/selection-store";
import { formatCount, peopleSelected, progressLine, SELECT_MODE_BAR, STOP } from "@/core/strings";
import { UI_LAYER } from "@/ui/layers";
import { tokens } from "@/ui/tokens.stylex";
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

const COUNT_TOOLTIP_ID = "lasso-selection-count-tooltip";

const spin = stylex.keyframes({
  "0%": { transform: "rotate(0deg)" },
  "100%": { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  bar: {
    backgroundColor: tokens.card,
    boxShadow: tokens.shadowElevated,
    position: "fixed",
    bottom: "1.5rem",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    borderRadius: tokens.radiusFull,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    boxSizing: "border-box",
  },
  spinner: {
    borderColor: tokens.border,
    borderTopColor: tokens.primary,
    height: "1rem",
    width: "1rem",
    animationName: spin,
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    borderRadius: tokens.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    boxSizing: "border-box",
  },
  progressText: {
    color: tokens.foreground,
    fontSize: tokens.textSm,
    fontVariantNumeric: "tabular-nums",
  },
  stopButton: {
    borderColor: tokens.border,
    color: tokens.foreground,
    borderRadius: tokens.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    fontSize: tokens.textSm,
    fontWeight: "600",
    transitionProperty: "transform, background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    cursor: "pointer",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.secondary,
    },
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  selectModeText: {
    color: tokens.mutedForeground,
    fontSize: tokens.textSm,
  },
  doneButton: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    borderRadius: tokens.radiusFull,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    fontSize: tokens.textSm,
    fontWeight: "600",
    transitionProperty: "transform, background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    borderWidth: 0,
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  facepileButton: {
    display: "flex",
    alignItems: "center",
    borderRadius: tokens.radiusFull,
    outline: "none",
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "pointer",
    padding: 0,
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
  facepileAvatarOverlap: {
    marginLeft: "-0.5rem",
  },
  facepileOverflow: {
    backgroundColor: tokens.secondary,
    color: tokens.mutedForeground,
    borderColor: tokens.card,
    fontSize: tokens.text2xs,
    zIndex: 10,
    display: "grid",
    placeItems: "center",
    height: "1.5rem",
    width: "1.5rem",
    borderRadius: tokens.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    fontWeight: "600",
    fontVariantNumeric: "tabular-nums",
    marginLeft: "-0.5rem",
    boxSizing: "border-box",
  },
  countButton: {
    color: tokens.mutedForeground,
    position: "relative",
    fontSize: tokens.textSm,
    fontVariantNumeric: "tabular-nums",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
  tooltip: {
    backgroundColor: tokens.foreground,
    color: tokens.background,
    boxShadow: tokens.shadowElevated,
    position: "absolute",
    bottom: "100%",
    left: "50%",
    zIndex: 10,
    marginBottom: "0.375rem",
    width: "max-content",
    transform: "translateX(-50%)",
    borderRadius: tokens.radiusMd,
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontSize: tokens.textXs,
    boxSizing: "border-box",
  },
  assignButton: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: tokens.radiusFull,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    fontSize: tokens.textSm,
    fontWeight: "600",
    transitionProperty: "transform, background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    borderWidth: 0,
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  keycapsWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.125rem",
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
  clearButton: {
    color: tokens.mutedForeground,
    borderRadius: tokens.radiusFull,
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontSize: tokens.textSm,
    transitionProperty: "transform, color, background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    borderWidth: 0,
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.secondary,
    },
    cursor: "pointer",
    ":hover": {
      color: tokens.foreground,
    },
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  reviewPopover: {
    backgroundColor: tokens.card,
    boxShadow: tokens.shadowElevated,
    position: "absolute",
    bottom: "100%",
    left: 0,
    marginBottom: "0.5rem",
    maxHeight: "280px",
    width: "16rem",
    overflowY: "auto",
    borderRadius: tokens.radiusXl,
    padding: "0.25rem",
    boxSizing: "border-box",
  },
  reviewRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: tokens.radiusLg,
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.secondary,
    },
  },
  reviewName: {
    color: tokens.foreground,
    minWidth: 0,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: tokens.textSm,
  },
  reviewRemoveButton: {
    color: tokens.mutedForeground,
    borderRadius: tokens.radiusFull,
    paddingLeft: "0.375rem",
    paddingRight: "0.375rem",
    outline: "none",
    border: "none",
    background: "none",
    cursor: "pointer",
    ":hover": {
      color: tokens.foreground,
    },
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
  avatarImg: {
    borderColor: tokens.card,
    zIndex: 10,
    borderRadius: tokens.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    boxSizing: "border-box",
  },
  avatarFallback: {
    backgroundColor: tokens.secondary,
    color: tokens.mutedForeground,
    borderColor: tokens.card,
    fontSize: tokens.text2xs,
    zIndex: 10,
    display: "grid",
    placeItems: "center",
    borderRadius: tokens.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    fontWeight: "600",
    textTransform: "uppercase",
    boxSizing: "border-box",
  },
  crosshair: {
    color: tokens.mutedForeground,
  },
});

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
    <section
      aria-label="Lasso progress"
      {...stylex.props(styles.bar)}
      style={{ zIndex: UI_LAYER.app }}
    >
      <span aria-hidden="true" {...stylex.props(styles.spinner)} />
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        {...stylex.props(styles.progressText)}
      >
        {progressLine(running.current, running.total, running.listName)}
      </span>
      <button ref={stopRef} type="button" onClick={onStop} {...stylex.props(styles.stopButton)}>
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
    <section
      aria-label="Lasso select mode"
      {...stylex.props(styles.bar)}
      style={{ zIndex: UI_LAYER.app }}
    >
      <CrosshairGlyph />
      <span {...stylex.props(styles.selectModeText)}>{SELECT_MODE_BAR}</span>
      <button ref={doneRef} type="button" onClick={onDone} {...stylex.props(styles.doneButton)}>
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
        // reviewOpen ⇒ the dialog is rendered with a focusable remove button,
        /* v8 ignore next -- so the reviewDialogRef?. / ?? null fallback is a dead type guard */
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
    // Defensive refocus guards: SelectionBar unmounts at zero authors and review
    // stays open through single removals, so once a refocus is pending, reviewOpen
    // is still true and the rendered popover always has buttons in range.
    /* v8 ignore start */
    if (!props.reviewOpen) return;
    const buttons = reviewDialogRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    focusWithoutScroll(buttons[Math.min(requestedIndex, buttons.length - 1)] ?? null);
    /* v8 ignore stop */
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
    <section
      aria-label="Lasso selection"
      {...stylex.props(styles.bar)}
      style={{ zIndex: UI_LAYER.app }}
    >
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
        {...stylex.props(styles.facepileButton)}
      >
        {props.authors.slice(0, 3).map((a, i) => (
          <span key={a.screenName} {...stylex.props(i > 0 && styles.facepileAvatarOverlap)}>
            <Avatar author={a} size={24} />
          </span>
        ))}
        {props.authors.length > 3 && (
          <span {...stylex.props(styles.facepileOverflow)}>
            +{formatCount(props.authors.length - 3)}
          </span>
        )}
      </button>
      <button
        type="button"
        {...stylex.props(styles.countButton)}
        aria-describedby={tooltip ? COUNT_TOOLTIP_ID : undefined}
        onMouseEnter={onCountEnter}
        onMouseLeave={onCountLeave}
        onFocus={onCountEnter}
        onBlur={onCountLeave}
      >
        {peopleSelected(props.authors.length)}
        {tooltip && (
          <span id={COUNT_TOOLTIP_ID} role="tooltip" {...stylex.props(styles.tooltip)}>
            {tooltip}
          </span>
        )}
      </button>
      <button type="button" onClick={props.onAssign} {...stylex.props(styles.assignButton)}>
        Add to List
        {props.hintKeycaps && (
          <span {...stylex.props(styles.keycapsWrap)}>
            {props.hintKeycaps.map((k) => (
              <kbd key={k} {...stylex.props(styles.keycap)}>
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
        {...stylex.props(styles.clearButton)}
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
      {...stylex.props(styles.reviewPopover)}
    >
      {authors.map((a, index) => (
        <div key={a.screenName} {...stylex.props(styles.reviewRow)}>
          <Avatar author={a} size={28} />
          <span {...stylex.props(styles.reviewName)}>@{a.screenName}</span>
          <button
            type="button"
            aria-label={`Remove @${a.screenName}`}
            onClick={() => onRemove(a.screenName, index)}
            {...stylex.props(styles.reviewRemoveButton)}
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
        {...stylex.props(styles.avatarImg)}
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      aria-label={`@${author.screenName}`}
      {...stylex.props(styles.avatarFallback)}
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
      {...stylex.props(styles.crosshair)}
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
