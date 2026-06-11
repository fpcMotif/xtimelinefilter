import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import { DEFAULT_KEYMAP, type KeyBinding } from "@/content/keyboard";
import { type Coach, createCoach } from "@/core/coach";
import { detectPlatform, keycaps, type Platform } from "@/core/keycaps";
import {
  type BackendStrategy,
  createSettings,
  type LassoSettings,
  type SettingsStore,
  type StorageLike,
} from "@/core/settings";
import { clearLassoData, STORAGE_KEYS } from "@/core/storage-keys";
import { PRIVACY_LINE } from "@/core/strings";
import type { XList } from "@/core/x-client/types";
import { COMMAND_LABELS } from "@/ui/ShortcutsSheet";

/** Story beat 9: the promised backend disclosure, verbatim. */
export const ACTIVATION_COPY = {
  auto: "On every visit (default)",
  "on-demand": "Only when I click the toolbar icon",
} as const;

export const BACKEND_COPY: Record<BackendStrategy, string> = {
  dom: "Drive X's own menus — slow, but uses only what you could click yourself",
  rest: "X's public REST endpoints — fast, same calls X's site makes",
  graphql:
    "GraphQL — fastest; uses X's private endpoints and may break or be frowned upon. Opt in deliberately.",
};

export const DEFAULT_LIST_NONE = "None — always ask";
export const DEFAULT_LIST_HINT = "Alt+Shift+L adds straight to this List.";

export interface OptionsAppProps {
  settings?: SettingsStore;
  coach?: Coach;
  local?: StorageLike;
  sync?: StorageLike;
  keymap?: KeyBinding[];
  platform?: Platform;
}

/**
 * The real options page (story beat 9): every setting that existed only in
 * chrome.storage gets a surface, the strongest trust facts move into
 * user-facing copy, and the data Lasso keeps is named and wipeable.
 */
export function OptionsApp({
  settings = createSettings(),
  coach = createCoach(),
  local = chrome.storage.local as unknown as StorageLike,
  sync = chrome.storage.sync as unknown as StorageLike,
  keymap = DEFAULT_KEYMAP,
  platform = detectPlatform(),
}: OptionsAppProps) {
  const [current, setCurrent] = useState<LassoSettings | null>(null);
  const [lists, setLists] = useState<XList[]>([]);
  const [cleared, setCleared] = useState(false);
  const [replayed, setReplayed] = useState(false);

  useEffect(() => {
    void settings.get().then(setCurrent);
    void local.get(STORAGE_KEYS.lists).then((items) => {
      setLists((items[STORAGE_KEYS.lists] as XList[] | undefined) ?? []);
    });
  }, [settings, local]);

  if (!current) return null;

  const patch = (p: Partial<LassoSettings>) => void settings.set(p).then(setCurrent);

  return (
    <main class="text-ink mx-auto flex w-full max-w-[600px] flex-col gap-8 px-6 py-8">
      <h1 class="text-[20px] font-bold">Lasso settings</h1>

      <Section title="Activation">
        {(Object.keys(ACTIVATION_COPY) as Array<keyof typeof ACTIVATION_COPY>).map((value) => (
          <label key={value} class="flex cursor-pointer items-start gap-3 py-1.5 text-[15px]">
            <input
              type="radio"
              name="activation"
              aria-label={ACTIVATION_COPY[value]}
              checked={current.activation === value}
              onChange={() => patch({ activation: value })}
            />
            {ACTIVATION_COPY[value]}
          </label>
        ))}
      </Section>

      <Section title="How Lasso talks to X">
        {(Object.keys(BACKEND_COPY) as BackendStrategy[]).map((value) => (
          <label key={value} class="flex cursor-pointer items-start gap-3 py-1.5 text-[15px]">
            <input
              type="radio"
              name="backend"
              aria-label={BACKEND_COPY[value]}
              checked={current.backend === value}
              onChange={() => patch({ backend: value })}
            />
            {BACKEND_COPY[value]}
          </label>
        ))}
      </Section>

      <Section title="Default List">
        <select
          aria-label="Default List"
          value={current.defaultListId ?? ""}
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            patch({ defaultListId: id === "" ? undefined : id });
          }}
          class="border-line bg-surface w-full rounded-lg border px-3 py-2 text-[15px]"
        >
          <option value="">{DEFAULT_LIST_NONE}</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {current.defaultListId && <p class="text-muted mt-2 text-[13px]">{DEFAULT_LIST_HINT}</p>}
        {lists.length === 0 && (
          <p class="text-muted mt-2 text-[13px]">Open x.com once so Lasso can see your Lists.</p>
        )}
      </Section>

      <Section title="Keyboard shortcuts">
        <table class="w-full">
          <tbody>
            {keymap.map((binding) => (
              <tr key={binding.combo}>
                <td class="py-1 text-[15px]">{COMMAND_LABELS[binding.command]}</td>
                <td class="py-1 text-right">
                  {keycaps(binding.combo, platform).map((cap) => (
                    <kbd
                      key={cap}
                      class="border-line ml-0.5 rounded border px-1.5 py-0.5 text-[12px]"
                    >
                      {cap}
                    </kbd>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="text-muted mt-2 text-[13px]">Press ? on x.com anytime.</p>
      </Section>

      <Section title="Accessibility">
        <label class="flex cursor-pointer items-center gap-3 py-1.5 text-[15px]">
          <input
            type="checkbox"
            aria-label="Higher-contrast buttons"
            checked={current.highContrast}
            onChange={(e) => patch({ highContrast: (e.currentTarget as HTMLInputElement).checked })}
          />
          Higher-contrast buttons
        </label>
      </Section>

      <Section title="Privacy & data">
        <p class="text-[15px]">{PRIVACY_LINE}</p>
        <div class="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() =>
              void clearLassoData(local, sync).then(() => {
                setCleared(true);
                setLists([]);
                void settings.get().then(setCurrent);
              })
            }
            class="border-line hover:bg-elevated rounded-full border px-4 py-1.5 text-sm font-semibold"
          >
            Clear Lasso data
          </button>
          {cleared && <span class="text-muted text-sm">Cleared</span>}
          <button
            type="button"
            onClick={() => void coach.replayIntro().then(() => setReplayed(true))}
            class="border-line hover:bg-elevated rounded-full border px-4 py-1.5 text-sm font-semibold"
          >
            Replay intro
          </button>
          {replayed && <span class="text-muted text-sm">On your next visit to x.com</span>}
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section>
      <h2 class="border-line mb-2 border-b pb-2 text-[17px] font-bold">{title}</h2>
      {children}
    </section>
  );
}
