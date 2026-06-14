import { useEffect, useState } from "preact/hooks";

import type { FilterStore } from "@/core/filter-store";
import { type LassoSettings, type SettingsStore } from "@/core/settings";
import { useSignalValue } from "@/ui/use-signal-value";

const INPUT = "border-line bg-surface rounded-lg border px-3 py-2 text-[15px]";
const BTN = "border-line hover:bg-elevated rounded-full border px-3 py-1.5 text-sm font-semibold";

const SURFACE_COPY: Record<keyof LassoSettings["surfaces"], string> = {
  pill: "Floating pill",
  palette: "Command palette",
  bar: "In-feed status bar",
};
const SURFACES = Object.keys(SURFACE_COPY) as Array<keyof LassoSettings["surfaces"]>;

/** Independent per-surface toggles + the palette hotkey, bound to LassoSettings. */
export function SurfaceOptions({ settings }: { settings: SettingsStore }) {
  const [current, setCurrent] = useState<LassoSettings | null>(null);

  useEffect(() => {
    void settings.get().then(setCurrent);
    return settings.subscribe(setCurrent);
  }, [settings]);

  if (!current) return null;

  const patch = (p: Partial<LassoSettings>) => void settings.set(p).then(setCurrent);

  return (
    <div class="flex flex-col gap-3">
      {SURFACES.map((surface) => (
        <label key={surface} class="flex cursor-pointer items-center gap-3 py-1 text-[15px]">
          <input
            type="checkbox"
            aria-label={SURFACE_COPY[surface]}
            checked={current.surfaces[surface]}
            onChange={(e) =>
              patch({
                surfaces: {
                  ...current.surfaces,
                  [surface]: (e.currentTarget as HTMLInputElement).checked,
                },
              })
            }
          />
          {SURFACE_COPY[surface]}
        </label>
      ))}
      <label class="flex flex-col gap-1 text-[13px]">
        Palette hotkey
        <input
          aria-label="Palette hotkey"
          placeholder="e.g. mod+shift+f"
          value={current.paletteHotkey}
          onChange={(e) =>
            patch({ paletteHotkey: (e.currentTarget as HTMLInputElement).value.trim() })
          }
          class={INPUT}
        />
      </label>
    </div>
  );
}

/** Lists saved filter presets with rename + delete, bound to the filter store. */
export function PresetManager({ store }: { store: FilterStore }) {
  const { presets } = useSignalValue(store.state);

  const rename = (id: string, current: string) => {
    const next = window.prompt("Rename preset", current)?.trim();
    if (next) store.renamePreset(id, next);
  };

  return (
    <ul class="flex flex-col gap-1">
      {presets.map((preset) => (
        <li key={preset.id} class="flex items-center gap-2 text-[14px]">
          <span>{preset.name}</span>
          <button
            type="button"
            aria-label={`Rename ${preset.name}`}
            onClick={() => rename(preset.id, preset.name)}
            class={`${BTN} ml-auto`}
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Delete ${preset.name}`}
            onClick={() => store.deletePreset(preset.id)}
            class={BTN}
          >
            Delete
          </button>
        </li>
      ))}
      {presets.length === 0 && <li class="text-muted text-[13px]">No saved presets yet.</li>}
    </ul>
  );
}
