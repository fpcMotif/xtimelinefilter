import { useEffect, useState } from "preact/hooks";

import { detectPlatform, keycaps, type Platform } from "@/core/keycaps";
import { POPUP_ACTIVE, POPUP_ASLEEP } from "@/core/strings";

/** Discoverability for users who never press ? (story beat 9). */
export const TOP_SHORTCUTS: ReadonlyArray<{ combo: string; label: string }> = [
  { combo: "Alt+l", label: "File the author into a List" },
  { combo: "s", label: "Select many people" },
  { combo: "?", label: "Every shortcut" },
];

export type TabState = "active" | "asleep" | "off-x";

export interface PopupDeps {
  /** Resolve the active tab's Lasso state. */
  queryState(): Promise<TabState>;
  /** Wake a dormant tab (sends lasso-activate). */
  wake(): Promise<void>;
  openOptions(): void;
  platform?: Platform;
}

export function PopupApp({ queryState, wake, openOptions, platform }: PopupDeps) {
  const [state, setState] = useState<TabState | null>(null);
  const plat = platform ?? detectPlatform();

  useEffect(() => {
    void queryState().then(setState);
  }, [queryState]);

  return (
    <main class="text-ink flex w-[280px] flex-col gap-3 p-4">
      <header class="flex items-center gap-2">
        <img src="/icons/lasso-32.png" alt="" width="20" height="20" />
        <span class="text-[15px] font-bold">Lasso</span>
      </header>

      {state === "active" && <p class="text-muted text-sm">{POPUP_ACTIVE}</p>}
      {state === "asleep" && (
        <button
          type="button"
          onClick={() => void wake().then(() => setState("active"))}
          class="bg-accent text-accent-ink hover:bg-accent/90 rounded-full px-4 py-1.5 text-left text-sm font-semibold"
        >
          {POPUP_ASLEEP}
        </button>
      )}
      {state === "off-x" && <p class="text-muted text-sm">Open x.com to use Lasso</p>}

      <ul class="flex flex-col gap-1.5">
        {TOP_SHORTCUTS.map((s) => (
          <li key={s.combo} class="flex items-center justify-between text-sm">
            <span>{s.label}</span>
            <span>
              {keycaps(s.combo, plat).map((cap) => (
                <kbd key={cap} class="border-line ml-0.5 rounded border px-1.5 py-0.5 text-[11px]">
                  {cap}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={openOptions}
        class="text-accent self-start text-sm font-semibold hover:underline"
      >
        All settings →
      </button>
    </main>
  );
}
