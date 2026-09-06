import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "preact/hooks";

import { DEFAULT_KEYMAP, validatePaletteHotkey } from "@/content/keyboard";
import type { FilterStore } from "@/core/filter-store";
import type { LassoSettings, SettingsPatch } from "@/core/settings";
import { Button, Input, Switch } from "@/ui/components";
import { tokens } from "@/ui/tokens.stylex";
import { useSignalValue } from "@/ui/use-signal-value";

const SURFACE_COPY: Record<keyof LassoSettings["surfaces"], string> = {
  pill: "Floating pill",
  palette: "Command palette",
};
const SURFACES = Object.keys(SURFACE_COPY) as Array<keyof LassoSettings["surfaces"]>;

const styles = stylex.create({
  colGap2_5: {
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
  },
  surfaceCard: {
    borderColor: tokens.border,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    borderRadius: tokens.radiusXl,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.875rem",
    paddingRight: "0.875rem",
    paddingTop: "0.625rem",
    paddingBottom: "0.625rem",
    fontSize: tokens.textSm,
  },
  hotkeyWrap: {
    marginTop: "0.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
  },
  hotkeyLabel: {
    color: tokens.faint,
    fontSize: tokens.text2xs,
    fontWeight: "600",
    letterSpacing: "0.025em",
    textTransform: "uppercase",
  },
  errorText: {
    color: tokens.destructive,
    fontSize: tokens.textCompact,
    margin: 0,
  },
  rowGap2: {
    display: "flex",
    gap: "0.5rem",
  },
  flex1: {
    flex: 1,
  },
  presetList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    listStyleType: "none",
    padding: 0,
    margin: 0,
  },
  presetItem: {
    borderColor: tokens.border,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    borderRadius: tokens.radiusXl,
    borderWidth: "1px",
    borderStyle: "solid",
    paddingLeft: "0.875rem",
    paddingRight: "0.875rem",
    paddingTop: "0.5rem",
    paddingBottom: "0.5rem",
    fontSize: tokens.textSm,
  },
  presetName: {
    fontWeight: "500",
  },
  mlAuto: {
    marginLeft: "auto",
  },
  emptyNotice: {
    color: tokens.faint,
    fontSize: tokens.textCompact,
  },
});

/** Controlled surface fields. Settings authority stays with OptionsApp. */
export function SurfaceOptions({
  settings,
  onPatch,
}: {
  settings: LassoSettings;
  onPatch: (patch: SettingsPatch) => void;
}) {
  const [hotkeyDraft, setHotkeyDraft] = useState(settings.paletteHotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  useEffect(() => setHotkeyDraft(settings.paletteHotkey), [settings.paletteHotkey]);

  const changeHotkey = (value: string) => {
    const draft = value.trim();
    setHotkeyDraft(value);
    const error = validatePaletteHotkey(draft, DEFAULT_KEYMAP);
    setHotkeyError(error);
    if (!error) onPatch({ paletteHotkey: draft });
  };

  return (
    <div {...stylex.props(styles.colGap2_5)}>
      {SURFACES.map((surface) => (
        <div key={surface} {...stylex.props(styles.surfaceCard)}>
          {SURFACE_COPY[surface]}
          <Switch
            label={SURFACE_COPY[surface]}
            checked={settings.surfaces[surface]}
            onChange={(on) => onPatch({ surfaces: { [surface]: on } })}
          />
        </div>
      ))}
      <div {...stylex.props(styles.hotkeyWrap)}>
        <span {...stylex.props(styles.hotkeyLabel)}>Palette hotkey</span>
        <Input
          aria-label="Palette hotkey"
          placeholder="e.g. mod+shift+f"
          value={hotkeyDraft}
          aria-invalid={!!hotkeyError}
          aria-describedby={hotkeyError ? "palette-hotkey-error" : undefined}
          onChange={(e) => changeHotkey((e.currentTarget as HTMLInputElement).value)}
        />
        {hotkeyError && (
          <p id="palette-hotkey-error" role="alert" {...stylex.props(styles.errorText)}>
            {hotkeyError}
          </p>
        )}
      </div>
    </div>
  );
}

/** Saves, lists, renames, and deletes filter presets, bound to the filter store. */
export function PresetManager({ store }: { store: FilterStore }) {
  const { presets } = useSignalValue(store.state);
  const [draftName, setDraftName] = useState("");

  const rename = (id: string, current: string) => {
    const next = window.prompt("Rename preset", current)?.trim();
    if (next) store.renamePreset(id, next);
  };

  const save = () => {
    store.savePreset(draftName.trim());
    setDraftName("");
  };

  return (
    <div {...stylex.props(styles.colGap2_5)}>
      <div {...stylex.props(styles.rowGap2)}>
        <Input
          aria-label="New preset name"
          placeholder="Save the current selection as…"
          value={draftName}
          onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
          sx={styles.flex1}
        />
        <Button
          variant="secondary"
          aria-label="Save preset"
          disabled={!draftName.trim()}
          onClick={save}
        >
          Save
        </Button>
      </div>
      <ul {...stylex.props(styles.presetList)}>
        {presets.map((preset) => (
          <li key={preset.id} {...stylex.props(styles.presetItem)}>
            <span {...stylex.props(styles.presetName)}>{preset.name}</span>
            <Button
              variant="outline"
              size="sm"
              sx={styles.mlAuto}
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
        {presets.length === 0 && (
          <li {...stylex.props(styles.emptyNotice)}>No saved presets yet.</li>
        )}
      </ul>
    </div>
  );
}
