import * as stylex from "@stylexjs/stylex";

import { CRITERIA_GROUPS } from "@/core/filter-criteria";
import type { FilterStore } from "@/core/filter-store";
import type { FilterMode } from "@/core/filter-types";
import { tokens } from "@/ui/tokens.stylex";
import { useSignalValue } from "@/ui/use-signal-value";

const styles = stylex.create({
  legend: {
    color: tokens.faint,
    fontSize: tokens.text2xs,
    letterSpacing: "0.025em",
  },
  groupRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.375rem",
  },
  groupLabel: {
    color: tokens.faint,
    width: "3rem",
    flexShrink: 0,
    fontSize: "10px",
    fontWeight: "700",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  chipBase: {
    borderRadius: tokens.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.625rem",
    paddingRight: "0.625rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontSize: tokens.textXs,
    fontWeight: "500",
    transitionProperty: "transform, background-color, border-color, color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    cursor: "pointer",
    boxSizing: "border-box",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  chipOff: {
    borderColor: {
      default: tokens.border,
      ":hover": tokens.faint,
    },
    color: {
      default: tokens.mutedForeground,
      ":hover": tokens.foreground,
    },
    backgroundColor: "transparent",
  },
  chipOnly: {
    borderColor: tokens.primary,
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    boxShadow: "0 1px 2px 0 oklch(0 0 0 / 0.05)",
  },
  chipHide: {
    borderColor: `oklch(from ${tokens.destructive} l c h / 0.5)`,
    color: tokens.destructive,
    textDecorationLine: "line-through",
    backgroundColor: {
      default: "transparent",
      ":hover": `oklch(from ${tokens.destructive} l c h / 0.1)`,
    },
  },
});

const CHIP_STYLE_BY_MODE: Record<FilterMode, stylex.StyleXStyles> = {
  off: styles.chipOff,
  only: styles.chipOnly,
  hide: styles.chipHide,
};

/** The chip modes in cycle order — the slider's 0 → 2 scale. */
const MODES = ["off", "only", "hide"] as const satisfies readonly FilterMode[];
const MODE_INDEX: Record<FilterMode, number> = { off: 0, only: 1, hide: 2 };
const MODE_TEXT: Record<FilterMode, string> = { off: "off", only: "show only", hide: "hide" };

/** Forward cycles needed to reach `target` from `mode` (the store only cycles forward). */
function cyclesTo(mode: FilterMode, target: FilterMode): number {
  return (MODE_INDEX[target] - MODE_INDEX[mode] + MODES.length) % MODES.length;
}

const KEY_TARGET: Record<string, (mode: FilterMode) => FilterMode | undefined> = {
  ArrowRight: (mode) => MODES[(MODE_INDEX[mode] + 1) % MODES.length],
  ArrowUp: (mode) => MODES[(MODE_INDEX[mode] + 1) % MODES.length],
  ArrowLeft: (mode) => MODES[(MODE_INDEX[mode] + MODES.length - 1) % MODES.length],
  ArrowDown: (mode) => MODES[(MODE_INDEX[mode] + MODES.length - 1) % MODES.length],
  Home: () => "off",
  End: () => "hide",
};

export interface CriteriaMatrixProps {
  store: FilterStore;
  /**
   * Conduct in-page Filter *commands* (cycling a criterion) through the
   * controller's fail-open wall. Omitted (popup-less surfaces like Options) ⇒
   * the cycle runs directly on the store.
   */
  conduct?: (run: (s: FilterStore) => void) => void;
  /**
   * Render the family-grouped chips. The legend always shows; the chips hide
   * when `false` so the in-page pill can collapse them with the master toggle
   * while the Options workshop keeps them armed even when the filter is off.
   */
  show?: boolean;
}

/**
 * The Filter's family-grouped tri-state chip grid (Type / Links / Source) plus
 * the "off · show only · hide" legend. Shared across:
 *
 *   1. The in-page filter popover (funnel pill, story beat 4).
 *   2. The Options → Filter workshop (story beat 6).
 *
 * Operates purely on `FilterStore` — changing a chip cycles through the three
 * states and immediately writes to chrome.storage.
 */
export function CriteriaMatrix({ store, conduct, show = true }: CriteriaMatrixProps) {
  // Commands route through the conductor's fail-open wall in-page; with no
  // conductor (Options) they run directly on the store.
  const cmd = conduct ?? ((run: (s: FilterStore) => void) => run(store));
  const state = useSignalValue(store.state);

  return (
    <>
      <span {...stylex.props(styles.legend)}>off · show only · hide</span>
      {show &&
        CRITERIA_GROUPS.map(({ group, criteria }) => (
          <div key={group} {...stylex.props(styles.groupRow)}>
            <span {...stylex.props(styles.groupLabel)}>{group}</span>
            {criteria.map((chip) => {
              const mode: FilterMode = state.criteria[chip.id] ?? "off";
              // One conducted command per key press, however many forward
              // cycles the jump takes (the store only cycles forward).
              const cycleTo = (target: FilterMode) => {
                const cycles = cyclesTo(mode, target);
                if (cycles === 0) return;
                cmd((s) => {
                  for (let i = 0; i < cycles; i += 1) s.cycle(chip.id);
                });
              };
              return (
                <button
                  key={chip.id}
                  type="button"
                  role="slider"
                  aria-label={chip.label}
                  aria-valuemin={0}
                  aria-valuemax={MODES.length - 1}
                  aria-valuenow={MODE_INDEX[mode]}
                  aria-valuetext={MODE_TEXT[mode]}
                  title={`${chip.label}: ${MODE_TEXT[mode]}. Click or use arrow keys to change.`}
                  data-mode={mode}
                  onClick={() => cmd((s) => s.cycle(chip.id))}
                  onKeyDown={(event) => {
                    const target = KEY_TARGET[event.key]?.(mode);
                    if (target === undefined || target === mode) return;
                    event.preventDefault();
                    cycleTo(target);
                  }}
                  {...stylex.props(styles.chipBase, CHIP_STYLE_BY_MODE[mode])}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        ))}
    </>
  );
}
