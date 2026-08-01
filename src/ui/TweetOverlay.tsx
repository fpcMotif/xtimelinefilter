import { useId } from "preact/hooks";

import { SAVE_POST_LABEL } from "@/core/strings";

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

const controlClass = (shown: boolean, filled: boolean): string =>
  `group focus-visible:ring-ring/55 relative grid h-[22px] w-[22px] place-items-center rounded-full border-2 text-xs leading-none transition-[opacity,border-color] duration-150 ease-out outline-none before:absolute before:-inset-2 before:content-[''] focus-visible:ring-2 active:scale-[0.96] ${
    filled
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-card text-foreground hover:border-primary"
  } ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`;

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
    <span class="relative inline-flex items-center gap-1">
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
        class={controlClass(shown, selected)}
      >
        <span
          class={selected ? "" : "opacity-0 transition-opacity duration-150 group-hover:opacity-40"}
        >
          ✓
        </span>
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
          class={controlClass(shown, false)}
        >
          <span aria-hidden="true" class="text-[11px] font-semibold leading-none">
            ⤵
          </span>
        </button>
      )}
      {tooltip && (
        <span
          id={tooltipId}
          role="tooltip"
          class="bg-foreground text-background shadow-elevated absolute top-full left-1/2 z-10 mt-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-md px-2 py-1 text-xs"
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}
