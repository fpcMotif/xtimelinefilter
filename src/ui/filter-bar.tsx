import type { FilterStore } from "@/core/filter-store";
import { FilterPanel } from "@/ui/filter-panel";

export interface FilterBarProps {
  store: FilterStore;
  hiddenCount: () => number;
}

/**
 * The Filter's in-feed surface — the lowest-priority placement. A thin wrapper
 * that mounts the shared <FilterPanel> body under the tab strip; sticky
 * positioning is the mount's job (task 016). All chip/toggle/preset behaviour
 * lives in FilterPanel so every surface stays consistent.
 */
export function FilterBar({ store, hiddenCount }: FilterBarProps) {
  return (
    <section aria-label="Timeline filter">
      <FilterPanel store={store} hiddenCount={hiddenCount} />
    </section>
  );
}
