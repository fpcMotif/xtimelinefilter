import { useEffect, useState } from "preact/hooks";

import type { FilterStore } from "@/core/filter-store";
import { type LassoSettings, type SettingsStore } from "@/core/settings";
import { Button, Input, Switch } from "@/ui/components";
import { useSignalValue } from "@/ui/use-signal-value";

const SURFACE_COPY: Record<keyof LassoSettings["surfaces"], string> = {
  pill: "Floating pill",
  palette: "Command palette",
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
    <div class="flex flex-col gap-2.5">
      {SURFACES.map((surface) => (
        <div
          key={surface}
          class="border-border flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-[14px]"
        >
          {SURFACE_COPY[surface]}
          <Switch
            label={SURFACE_COPY[surface]}
            checked={current.surfaces[surface]}
            onChange={(on) => patch({ surfaces: { ...current.surfaces, [surface]: on } })}
          />
        </div>
      ))}
      <div class="mt-1 flex flex-col gap-1.5">
        <span class="text-faint text-[11px] font-semibold tracking-wide uppercase">
          Palette hotkey
        </span>
        <Input
          aria-label="Palette hotkey"
          placeholder="e.g. mod+shift+f"
          value={current.paletteHotkey}
          onChange={(e) =>
            patch({ paletteHotkey: (e.currentTarget as HTMLInputElement).value.trim() })
          }
        />
      </div>
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
    <ul class="flex flex-col gap-1.5">
      {presets.map((preset) => (
        <li
          key={preset.id}
          class="border-border flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[14px]"
        >
          <span class="font-medium">{preset.name}</span>
          <Button
            variant="outline"
            size="sm"
            class="ml-auto"
            aria-label={`Rename ${preset.name}`}
            onClick={() => rename(preset.id, preset.name)}
          >
            Rename
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Delete ${preset.name}`}
            onClick={() => store.deletePreset(preset.id)}
          >
            Delete
          </Button>
        </li>
      ))}
      {presets.length === 0 && <li class="text-faint text-[13px]">No saved presets yet.</li>}
    </ul>
  );
}
