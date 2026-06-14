import { useState } from "preact/hooks";

import type { FilterStore } from "@/core/filter-store";
import type { CriterionId, FilterMode } from "@/core/filter-types";
import { useSignalValue } from "@/ui/use-signal-value";

interface Chip {
  id: CriterionId;
  label: string;
}

/** Criterion catalog, grouped by Family. Language is a single toggle, not chips (v1). */
const FAMILIES: { family: string; chips: Chip[] }[] = [
  {
    family: "Type",
    chips: [
      { id: "kind:text", label: "Text" },
      { id: "kind:photo", label: "Photo" },
      { id: "kind:video", label: "Video" },
      { id: "kind:quote", label: "Quote" },
      { id: "kind:link", label: "Link" },
    ],
  },
  {
    family: "Links",
    chips: [
      { id: "linkDest:arxiv", label: "arXiv" },
      { id: "linkDest:hn", label: "Hacker News" },
      { id: "linkDest:reddit", label: "Reddit" },
      { id: "linkDest:youtube", label: "YouTube" },
      { id: "linkDest:github", label: "GitHub" },
      { id: "linkDest:article", label: "Article/Blog" },
    ],
  },
  { family: "Source", chips: [{ id: "role:repost", label: "Repost" }] },
];

const CHIP_BASE =
  "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-transform duration-150 ease-out active:scale-[0.96]";
const CHIP_BY_MODE: Record<FilterMode, string> = {
  off: "border-line text-muted hover:text-ink",
  only: "border-accent text-accent-ink bg-accent",
  hide: "border-danger text-danger line-through",
};

export interface FilterPanelProps {
  store: FilterStore;
  /** When provided, render the "N hidden · show all" line. Omit for surfaces with no live count (popup). */
  hiddenCount?: () => number;
}

/**
 * The Filter's shared, placement-agnostic body: family-grouped tri-state chips, a
 * legend, the master toggle, the single "only my languages" gate, an optional
 * hidden-count line with "show all", and a presets row (apply + save only —
 * rename/delete live in Options). Every surface (in-feed bar, popover, popup)
 * hosts this; positioning is the mount's job. No innerHTML of page data (ADR-0003).
 */
export function FilterPanel({ store, hiddenCount }: FilterPanelProps) {
  const state = useSignalValue(store.state);
  const [draftName, setDraftName] = useState("");
  const hidden = hiddenCount?.();

  function onSave() {
    const name = draftName.trim();
    if (!name) return;
    store.savePreset(name);
    setDraftName("");
  }

  return (
    <div class="bg-surface text-ink flex flex-col gap-2 p-2 text-sm">
      <div class="flex items-center gap-3">
        <label class="flex cursor-pointer items-center gap-1.5 text-[12px]">
          <input
            type="checkbox"
            aria-label="Timeline filter enabled"
            checked={state.enabled}
            onChange={(e) => store.setEnabled((e.currentTarget as HTMLInputElement).checked)}
          />
          Filter
        </label>
        <label class="flex cursor-pointer items-center gap-1.5 text-[12px]">
          <input
            type="checkbox"
            aria-label="Only my languages"
            checked={state.onlyMyLanguages}
            onChange={(e) =>
              store.setOnlyMyLanguages((e.currentTarget as HTMLInputElement).checked)
            }
          />
          Only my languages
        </label>
        {hidden !== undefined && (
          <span class="text-muted ml-auto text-[12px] tabular-nums">
            {hidden} hidden
            {state.enabled && hidden > 0 && (
              <button
                type="button"
                onClick={() => store.setEnabled(false)}
                class="text-accent-ink ml-2 underline"
              >
                show all
              </button>
            )}
          </span>
        )}
      </div>

      <span class="text-muted text-[11px]">◯ off · ◉ only · ⊘ hide</span>

      {state.enabled &&
        FAMILIES.map(({ family, chips }) => (
          <div key={family} class="flex flex-wrap items-center gap-1.5">
            <span class="text-muted w-12 shrink-0 text-[11px] uppercase">{family}</span>
            {chips.map((chip) => {
              const mode: FilterMode = state.criteria[chip.id] ?? "off";
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-label={chip.label}
                  title={mode === "off" ? chip.label : `${chip.label}: ${mode}`}
                  data-mode={mode}
                  onClick={() => store.cycle(chip.id)}
                  class={`${CHIP_BASE} ${CHIP_BY_MODE[mode]}`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        ))}

      <div class="border-line flex flex-wrap items-center gap-1.5 border-t pt-2">
        <span class="text-muted w-12 shrink-0 text-[11px] uppercase">Presets</span>
        {state.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => store.applyPreset(preset.id)}
            class="border-line text-muted hover:text-ink rounded-full border px-2.5 py-1 text-[12px] font-medium"
          >
            {preset.name}
          </button>
        ))}
        <input
          type="text"
          aria-label="Preset name"
          placeholder="Name…"
          value={draftName}
          onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
          class="border-line bg-surface text-ink ml-auto w-24 rounded border px-2 py-1 text-[12px]"
        />
        <button
          type="button"
          onClick={onSave}
          class="border-accent text-accent-ink bg-accent rounded border px-2.5 py-1 text-[12px] font-medium"
        >
          Save
        </button>
      </div>
    </div>
  );
}
