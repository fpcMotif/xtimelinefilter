export interface ActionBarProps {
  count: number;
  onAssign: () => void;
  onClear: () => void;
}

/** Floating bar shown while authors are selected. Hidden when the selection is empty. */
export function ActionBar({ count, onAssign, onClear }: ActionBarProps) {
  if (count === 0) return null;
  return (
    <section
      aria-label="Lasso selection"
      class="bg-surface shadow-elevated fixed bottom-6 left-1/2 z-[2147483646] flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2"
    >
      <span class="text-muted text-sm tabular-nums">{count} selected</span>
      <button
        type="button"
        onClick={onAssign}
        class="bg-accent text-accent-ink hover:bg-accent/90 rounded-full px-4 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]"
      >
        Add to list
      </button>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={onClear}
        class="border-line text-ink hover:bg-elevated rounded-full border px-3 py-1.5 text-sm transition-transform duration-150 ease-out active:scale-[0.96]"
      >
        Clear
      </button>
    </section>
  );
}
