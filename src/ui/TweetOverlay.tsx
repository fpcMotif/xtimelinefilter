export interface TweetOverlayProps {
  selected: boolean;
  /** Checks are hidden by default; they fade in on post hover or in select mode. */
  visible: boolean;
  onToggle: () => void;
  /** One-time first-hover coach tip (story beat 4). */
  tooltip?: string | null;
}

/**
 * Per-post selection check: 22px circle at the avatar's corner (where X puts
 * its own DM-select check). Hover brightens the border and previews a 40%
 * ghost check; selected fills X-blue and stays visible while scrolling.
 */
export function TweetOverlay({ selected, visible, onToggle, tooltip }: TweetOverlayProps) {
  const shown = visible || selected;
  return (
    <span class="relative inline-block">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selected ? "Deselect this author" : "Select this author"}
        tabIndex={shown ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onToggle();
        }}
        class={`group relative grid h-[22px] w-[22px] place-items-center rounded-full border-2 text-[12px] leading-none transition-[opacity,border-color] duration-150 ease-out before:absolute before:-inset-2 before:content-[''] active:scale-[0.96] ${
          selected
            ? "border-accent bg-accent text-accent-ink"
            : "border-line bg-surface text-ink hover:border-accent"
        } ${shown ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <span
          class={selected ? "" : "opacity-0 transition-opacity duration-150 group-hover:opacity-40"}
        >
          ✓
        </span>
      </button>
      {tooltip && (
        <span
          role="tooltip"
          class="bg-ink text-surface shadow-elevated absolute top-full left-1/2 z-10 mt-1.5 w-max max-w-[240px] -translate-x-1/2 rounded-md px-2 py-1 text-[12px]"
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}
