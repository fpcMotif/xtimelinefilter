import { useEffect, useRef, useState } from "preact/hooks";

import { DEFAULT_KEYMAP, validatePaletteHotkey } from "@/content/keyboard";
import type { FilterStore } from "@/core/filter-store";
import { type LassoSettings, type SettingsStore } from "@/core/settings";
import { Button, Input, Switch } from "@/ui/components";
import { useSignalValue } from "@/ui/use-signal-value";

const SURFACE_COPY: Record<keyof LassoSettings["surfaces"], string> = {
  pill: "Floating pill",
  palette: "Command palette",
};
const SURFACES = Object.keys(SURFACE_COPY) as Array<keyof LassoSettings["surfaces"]>;

interface SaveRequest {
  generation: number;
  authorityEpoch: number;
  revision: number;
  next: LassoSettings;
  confirmedBySubscription: boolean;
}

function sameSettings(left: LassoSettings, right: LassoSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Independent per-surface toggles + the palette hotkey, bound to LassoSettings. */
export function SurfaceOptions({ settings }: { settings: SettingsStore }) {
  const [current, setCurrent] = useState<LassoSettings | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const revision = useRef(0);
  const generation = useRef(0);
  const authorityEpoch = useRef(0);
  const latest = useRef<LassoSettings | null>(null);
  const confirmed = useRef<LassoSettings | null>(null);
  const saves = useRef<SaveRequest[]>([]);
  const latestConfirmedSave = useRef(0);

  const show = (snapshot: LassoSettings) => {
    latest.current = snapshot;
    setCurrent(snapshot);
    setHotkeyDraft(snapshot.paletteHotkey);
    setSaveError(null);
  };

  useEffect(() => {
    const thisGeneration = ++generation.current;
    let mounted = true;
    latest.current = null;
    confirmed.current = null;
    saves.current = [];
    latestConfirmedSave.current = 0;
    setCurrent(null);

    const adoptExternal = (snapshot: LassoSettings) => {
      if (!mounted || generation.current !== thisGeneration) return;
      const matchingLocalSave = saves.current.find(
        (save) =>
          save.generation === thisGeneration &&
          save.authorityEpoch === authorityEpoch.current &&
          sameSettings(save.next, snapshot),
      );
      if (matchingLocalSave) {
        // createSettings notifies its own successful writes. Confirm that write,
        // but leave a later local edit visible until it settles.
        matchingLocalSave.confirmedBySubscription = true;
        if (matchingLocalSave.revision >= latestConfirmedSave.current) {
          latestConfirmedSave.current = matchingLocalSave.revision;
          confirmed.current = snapshot;
          if (revision.current === matchingLocalSave.revision) show(snapshot);
        }
        return;
      }

      // A distinct subscription value is cross-context authority. Old local
      // completions may still arrive, but cannot replace it.
      authorityEpoch.current += 1;
      revision.current += 1;
      latestConfirmedSave.current = 0;
      confirmed.current = snapshot;
      show(snapshot);
    };

    // The listener is live before the initial read. A newer storage event wins
    // over the late read, even when get() itself triggers that event.
    const unsubscribe = settings.subscribe(adoptExternal);
    const initialRevision = revision.current;
    void Promise.resolve()
      .then(() => settings.get())
      .then((snapshot) => {
        if (revision.current !== initialRevision || !mounted) return;
        confirmed.current = snapshot;
        show(snapshot);
      })
      .catch(() => {
        if (revision.current === initialRevision && mounted) {
          setSaveError("Could not load surface settings.");
        }
      });

    return () => {
      mounted = false;
      saves.current = [];
      unsubscribe();
    };
  }, [settings]);

  const patch = (change: Partial<LassoSettings>, requestRevision = ++revision.current) => {
    const base = latest.current;
    /* v8 ignore next -- patch is bound only to handlers that render iff current!=null, and show() sets current and latest.current together, so base is never null here. */
    if (!base) return;

    const requestGeneration = generation.current;
    const requestAuthorityEpoch = authorityEpoch.current;
    const next = { ...base, ...change };
    const request: SaveRequest = {
      generation: requestGeneration,
      authorityEpoch: requestAuthorityEpoch,
      revision: requestRevision,
      next,
      confirmedBySubscription: false,
    };
    saves.current.push(request);
    show(next);

    const remove = () => {
      const index = saves.current.indexOf(request);
      if (index >= 0) saves.current.splice(index, 1);
    };
    const accept = (snapshot: LassoSettings) => {
      remove();
      if (
        generation.current !== requestGeneration ||
        authorityEpoch.current !== requestAuthorityEpoch
      )
        return;

      if (requestRevision >= latestConfirmedSave.current) {
        latestConfirmedSave.current = requestRevision;
        confirmed.current = snapshot;
      }
      const hasNewerPendingSave = saves.current.some((save) => save.revision > requestRevision);
      if (
        revision.current === requestRevision ||
        (!hasNewerPendingSave && latestConfirmedSave.current === requestRevision)
      ) {
        show(snapshot);
      }
    };
    const reject = () => {
      remove();
      if (
        generation.current !== requestGeneration ||
        authorityEpoch.current !== requestAuthorityEpoch ||
        revision.current !== requestRevision
      ) {
        return;
      }

      // A matching subscription already proved storage authority. A later local
      // rejection is not a rollback condition.
      if (request.confirmedBySubscription && confirmed.current) {
        show(confirmed.current);
        return;
      }

      /* v8 ignore next -- reject() runs only from patch(), which returns early unless latest.current is set; current turns non-null only via a show() that also assigns confirmed.current (initial load or a distinct external snapshot), and confirmed is never cleared while current stays set, so confirmed.current is always truthy here. */
      if (confirmed.current) show(confirmed.current);
      setSaveError("Could not save surface settings.");
    };

    try {
      void Promise.resolve(settings.set(change)).then(accept, reject);
    } catch {
      reject();
    }
  };

  const changeHotkey = (value: string) => {
    const inputRevision = ++revision.current;
    const draft = value.trim();
    setHotkeyDraft(value);
    const error = validatePaletteHotkey(draft, DEFAULT_KEYMAP);
    setHotkeyError(error);
    if (!error) patch({ paletteHotkey: draft }, inputRevision);
  };

  if (!current) {
    return saveError ? (
      <p role="alert" class="text-destructive text-compact">
        {saveError}
      </p>
    ) : null;
  }

  return (
    <div class="flex flex-col gap-2.5">
      {SURFACES.map((surface) => (
        <div
          key={surface}
          class="border-border flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
        >
          {SURFACE_COPY[surface]}
          <Switch
            label={SURFACE_COPY[surface]}
            checked={current.surfaces[surface]}
            onChange={(on) =>
              patch({
                surfaces: { ...latest.current!.surfaces, [surface]: on },
              })
            }
          />
        </div>
      ))}
      <div class="mt-1 flex flex-col gap-1.5">
        <span class="text-faint text-2xs font-semibold tracking-wide uppercase">
          Palette hotkey
        </span>
        <Input
          aria-label="Palette hotkey"
          placeholder="e.g. mod+shift+f"
          value={hotkeyDraft}
          aria-invalid={!!hotkeyError}
          aria-describedby={hotkeyError ? "palette-hotkey-error" : undefined}
          onChange={(e) => changeHotkey((e.currentTarget as HTMLInputElement).value)}
        />
        {hotkeyError && (
          <p id="palette-hotkey-error" role="alert" class="text-destructive text-compact">
            {hotkeyError}
          </p>
        )}
        {saveError && (
          <p role="alert" class="text-destructive text-compact">
            {saveError}
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
    <div class="flex flex-col gap-2.5">
      <div class="flex gap-2">
        <Input
          aria-label="New preset name"
          placeholder="Save the current selection as…"
          value={draftName}
          onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
          class="flex-1"
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
      <ul class="flex flex-col gap-1.5">
        {presets.map((preset) => (
          <li
            key={preset.id}
            class="border-border flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm"
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
        {presets.length === 0 && <li class="text-faint text-compact">No saved presets yet.</li>}
      </ul>
    </div>
  );
}
