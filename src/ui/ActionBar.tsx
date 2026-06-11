import { useState } from "preact/hooks";

import type { RunningAssign } from "@/content/app-state";
import type { TweetAuthor } from "@/core/selection-store";
import { formatCount, peopleSelected, progressLine, SELECT_MODE_BAR, STOP } from "@/core/strings";

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
  "bg-surface shadow-elevated fixed bottom-6 left-1/2 z-[2147483646] flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2";

/**
 * The floating bar (story beats 4 & 7): facepile · "N people selected" ·
 * Add to List · ✕. In select mode it appears even at zero count; during a run
 * it becomes the progress surface with a Stop pill.
 */
export function ActionBar(props: ActionBarProps) {
  if (props.running) return <ProgressBar running={props.running} onStop={props.onStop} />;
  if (props.authors.length === 0) {
    return props.selectMode ? <SelectModeBar onDone={props.onDone} /> : null;
  }
  return <SelectionBar {...props} />;
}

function ProgressBar({ running, onStop }: { running: RunningAssign; onStop(): void }) {
  return (
    <section aria-label="Lasso progress" class={BAR_CLASS}>
      <span
        aria-hidden="true"
        class="border-line border-t-accent h-4 w-4 animate-spin rounded-full border-2"
      />
      <span class="text-ink text-sm tabular-nums">
        {progressLine(running.current, running.total, running.listName)}
      </span>
      <button
        type="button"
        onClick={onStop}
        class="border-line text-ink hover:bg-elevated rounded-full border px-3 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]"
      >
        {STOP}
      </button>
    </section>
  );
}

function SelectModeBar({ onDone }: { onDone(): void }) {
  return (
    <section aria-label="Lasso select mode" class={BAR_CLASS}>
      <CrosshairGlyph />
      <span class="text-muted text-sm">{SELECT_MODE_BAR}</span>
      <button
        type="button"
        onClick={onDone}
        class="bg-accent text-accent-ink hover:bg-accent/90 rounded-full px-4 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]"
      >
        Done
      </button>
    </section>
  );
}

function SelectionBar(props: ActionBarProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  return (
    <section aria-label="Lasso selection" class={BAR_CLASS}>
      {props.reviewOpen && <ReviewPopover authors={props.authors} onRemove={props.onRemove} />}
      <button
        type="button"
        aria-label="Review selected people"
        aria-expanded={props.reviewOpen}
        onClick={() => props.onToggleReview(!props.reviewOpen)}
        class="flex items-center -space-x-2"
      >
        {props.authors.slice(0, 3).map((a) => (
          <Avatar key={a.screenName} author={a} size={24} />
        ))}
        {props.authors.length > 3 && (
          <span class="bg-elevated text-muted border-surface z-10 grid h-6 w-6 place-items-center rounded-full border-2 text-[11px] font-semibold tabular-nums">
            +{formatCount(props.authors.length - 3)}
          </span>
        )}
      </button>
      <span
        class="text-muted relative text-sm tabular-nums"
        onMouseEnter={() => void props.onCountHover?.().then(setTooltip)}
        onMouseLeave={() => setTooltip(null)}
      >
        {peopleSelected(props.authors.length)}
        {tooltip && (
          <span
            role="tooltip"
            class="bg-ink text-surface shadow-elevated absolute bottom-full left-1/2 z-10 mb-1.5 w-max -translate-x-1/2 rounded-md px-2 py-1 text-[12px]"
          >
            {tooltip}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={props.onAssign}
        class="bg-accent text-accent-ink hover:bg-accent/90 flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.96]"
      >
        Add to List
        {props.hintKeycaps && (
          <span class="flex items-center gap-0.5">
            {props.hintKeycaps.map((k) => (
              <kbd key={k} class="rounded border border-white/40 px-1 text-[11px] leading-4">
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
        class="text-muted hover:bg-elevated hover:text-ink rounded-full px-2 py-1 text-sm transition-transform duration-150 ease-out active:scale-[0.96]"
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
}: {
  authors: TweetAuthor[];
  onRemove(screenName: string): void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Selected people"
      class="bg-surface shadow-elevated absolute bottom-full left-0 mb-2 max-h-[280px] w-64 overflow-y-auto rounded-2xl p-1"
    >
      {authors.map((a) => (
        <div
          key={a.screenName}
          class="hover:bg-elevated flex items-center gap-2 rounded-lg px-2 py-1.5"
        >
          <Avatar author={a} size={28} />
          <span class="text-ink min-w-0 flex-1 truncate text-sm">@{a.screenName}</span>
          <button
            type="button"
            aria-label={`Remove @${a.screenName}`}
            onClick={() => onRemove(a.screenName)}
            class="text-muted hover:text-ink rounded-full px-1.5"
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
        class="border-surface z-10 rounded-full border-2"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <span
      aria-label={`@${author.screenName}`}
      class="bg-elevated text-muted border-surface z-10 grid place-items-center rounded-full border-2 text-[11px] font-semibold uppercase"
      style={{ width: dim, height: dim }}
    >
      {author.screenName.slice(0, 1)}
    </span>
  );
}

function CrosshairGlyph() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" class="text-muted">
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
