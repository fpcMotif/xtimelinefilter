import * as stylex from "@stylexjs/stylex";
import { useId } from "preact/hooks";

import { SAVE_POST_LABEL } from "@/core/strings";
import { tokens } from "@/ui/tokens.stylex";

export interface TweetOverlayProps {
  /** Author handle without the leading @. */
  screenName: string;
  selected: boolean;
  /** Checks are hidden by default; they fade in on post hover or in select mode. */
  visible: boolean;
  onToggle: () => void;
  /**
   * Opens the Folder Picker for THIS post. Bound to the article at mount time,
   * so save works on threads where j/k focus resolution fails.
   */
  onSave?: () => void;
  /** Lets the coach expose a tip to keyboard users, not pointer users alone. */
  onFocusChange?(focused: boolean): void;
  /** One-time first-hover coach tip (story beat 4). */
  tooltip?: string | null;
}

const styles = stylex.create({
  root: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
  },
  control: {
    position: "relative",
    display: "grid",
    height: "22px",
    width: "22px",
    placeItems: "center",
    borderRadius: tokens.radiusFull,
    borderWidth: "2px",
    borderStyle: "solid",
    fontSize: tokens.textXs,
    lineHeight: 1,
    transitionProperty: "opacity, border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    cursor: "pointer",
    boxSizing: "border-box",
    "::before": {
      content: '""',
      position: "absolute",
      top: "-0.5rem",
      bottom: "-0.5rem",
      left: "-0.5rem",
      right: "-0.5rem",
    },
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  filled: {
    borderColor: tokens.primary,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  unfilled: {
    borderColor: {
      default: tokens.border,
      ":hover": tokens.primary,
    },
    backgroundColor: tokens.card,
    color: tokens.foreground,
  },
  shown: {
    opacity: 1,
  },
  hidden: {
    opacity: 0,
    pointerEvents: "none",
  },
  checkUnselected: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "150ms",
  },
  arrowText: {
    fontSize: tokens.text2xs,
    lineHeight: 1,
    fontWeight: "600",
  },
  tooltip: {
    backgroundColor: tokens.foreground,
    color: tokens.background,
    boxShadow: tokens.shadowElevated,
    position: "absolute",
    top: "100%",
    left: "50%",
    zIndex: 10,
    marginTop: "0.375rem",
    width: "max-content",
    maxWidth: "240px",
    transform: "translateX(-50%)",
    borderRadius: tokens.radiusMd,
    paddingLeft: "0.5rem",
    paddingRight: "0.5rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontSize: tokens.textXs,
    boxSizing: "border-box",
  },
});

/**
 * Per-post chrome at the avatar corner: selection check + optional save.
 * Hidden by default; fades in on hover / select mode / focus. Save is wired to
 * the article itself so it does not depend on j/k or hover-sticky targeting.
 */
export function TweetOverlay({
  screenName,
  selected,
  visible,
  onToggle,
  onSave,
  onFocusChange,
  tooltip,
}: TweetOverlayProps) {
  const shown = visible || selected;
  const tooltipId = useId();
  return (
    <span {...stylex.props(styles.root)}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? "Deselect" : "Select"} @${screenName}`}
        aria-describedby={tooltip ? tooltipId : undefined}
        tabIndex={shown ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggle();
        }}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        {...stylex.props(
          styles.control,
          selected ? styles.filled : styles.unfilled,
          shown ? styles.shown : styles.hidden,
        )}
      >
        <span {...stylex.props(!selected && styles.checkUnselected)}>✓</span>
      </button>
      {onSave && (
        <button
          type="button"
          aria-label={SAVE_POST_LABEL}
          tabIndex={shown ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onSave();
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          {...stylex.props(styles.control, styles.unfilled, shown ? styles.shown : styles.hidden)}
        >
          <span aria-hidden="true" {...stylex.props(styles.arrowText)}>
            ⤵
          </span>
        </button>
      )}
      {tooltip && (
        <span id={tooltipId} role="tooltip" {...stylex.props(styles.tooltip)}>
          {tooltip}
        </span>
      )}
    </span>
  );
}
