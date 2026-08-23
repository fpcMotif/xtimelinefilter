import { CRITERIA_GROUPS } from "@/core/filter-criteria";
import type { FilterStore } from "@/core/filter-store";
import type { FilterMode } from "@/core/filter-types";
import { useSignalValue } from "@/ui/use-signal-value";
const CHIP_BASE =
  "focus-visible:ring-ring/55 rounded-full border px-2.5 py-1 text-xs font-medium transition-[transform,background-color,border-color,color] duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]";
const CHIP_BY_MODE: Record<FilterMode, string> = {
  off: "border-border text-muted-foreground hover:text-foreground hover:border-faint",
  only: "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
  hide: "border-destructive/50 text-destructive line-through hover:bg-destructive/10",
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
 * its legend — the one criteria editor shared by the in-page <FilterPanel> and
 * the Options "Timeline filter" section, so the chip catalog, the cycle
 * semantics, and the mode styling live in exactly one place. A Fragment, not a
 * box: the host supplies the column spacing. No innerHTML of page data
 * (ADR-0003) — every label is a static catalog string.
 *
 * Each chip is an ARIA slider over the ordered off → only → hide scale: the
 * mode is a programmatic *value* (valuenow/valuetext), the accessible name
 * stays stable, and arrow keys/Home/End move along the scale. Clicking still
 * cycles forward, as mouse users expect.
 */
export function CriteriaMatrix({ store, conduct, show = true }: CriteriaMatrixProps) {
  // Commands route through the conductor's fail-open wall in-page; with no
  // conductor (Options) they run directly on the store.
  const cmd = conduct ?? ((run: (s: FilterStore) => void) => run(store));
  const state = useSignalValue(store.state);

  return (
    <>
      <span class="text-faint text-2xs tracking-wide">off · show only · hide</span>
      {show &&
        CRITERIA_GROUPS.map(({ group, criteria }) => (
          <div key={group} class="flex flex-wrap items-center gap-1.5">
            <span class="text-faint w-12 shrink-0 text-[10px] font-bold tracking-wider uppercase">
              {group}
            </span>
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
                  class={`${CHIP_BASE} ${CHIP_BY_MODE[mode]}`}
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
