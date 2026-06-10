export interface TweetOverlayProps {
  selected: boolean;
  onToggle: () => void;
}

/**
 * Per-tweet selection toggle. 20px visual, 40px hit area (before pseudo);
 * scale-on-press feedback. Blends into X via the oklch theme.
 */
export function TweetOverlay({ selected, onToggle }: TweetOverlayProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={selected ? "Deselect this author" : "Select this author"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      class={`relative grid h-5 w-5 place-items-center rounded-full border text-[11px] leading-none transition-transform duration-150 ease-out before:absolute before:-inset-2.5 before:content-[''] active:scale-[0.96] ${
        selected
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-surface text-transparent"
      }`}
    >
      ✓
    </button>
  );
}
