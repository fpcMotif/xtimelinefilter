import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";

/**
 * Onboarding + decaying-hint state (story beats 3 & 5). Hints are "decaying":
 * they show for 7 days or 5 assigns, whichever comes first, then the UI returns
 * to pure camouflage. "Replay intro" in Settings resets everything for a second
 * pass. Persisted under `lasso:coach` in chrome.storage.local.
 */

export const DECAY_MS = 7 * 24 * 60 * 60 * 1000;
export const DECAY_ASSIGNS = 5;

/** One-shot (or capped) in-product tips. */
export type TipId = "first-hover" | "unit" | "select-nudge" | "post-assign";

interface CoachState {
  onboarded?: boolean;
  installedAt?: number;
  assignCount?: number;
  tips?: Partial<Record<TipId, number>>;
}

export interface Coach {
  isOnboarded(): Promise<boolean>;
  markOnboarded(): Promise<void>;
  /** Bump the assign counter that decays the hint window. */
  recordAssign(): Promise<void>;
  /** True while the decaying-hint window is open; stamps installedAt on first call. */
  hintsActive(): Promise<boolean>;
  /**
   * Consume one showing of a tip; true if it should display now. Tips respect
   * both their own cap (`max`, default 1) and the decay window.
   */
  tryShowTip(id: TipId, max?: number): Promise<boolean>;
  /** Settings → Replay intro: welcome card and all hints come back. */
  replayIntro(): Promise<void>;
}

export function createCoach(
  area: StorageLike = chrome.storage.local as unknown as StorageLike,
  now: () => number = Date.now,
): Coach {
  const KEY = STORAGE_KEYS.coach;

  async function read(): Promise<CoachState> {
    return ((await area.get(KEY))[KEY] as CoachState | undefined) ?? {};
  }

  async function write(patch: Partial<CoachState>): Promise<CoachState> {
    const next = { ...(await read()), ...patch };
    await area.set({ [KEY]: next });
    return next;
  }

  async function ensureInstalledAt(): Promise<CoachState> {
    const s = await read();
    if (s.installedAt !== undefined) return s;
    return write({ installedAt: now() });
  }

  async function hintsActive(): Promise<boolean> {
    const s = await ensureInstalledAt();
    if ((s.assignCount ?? 0) >= DECAY_ASSIGNS) return false;
    return now() - (s.installedAt ?? now()) <= DECAY_MS;
  }

  return {
    async isOnboarded() {
      return (await read()).onboarded === true;
    },
    async markOnboarded() {
      await write({ onboarded: true });
    },
    async recordAssign() {
      const s = await read();
      await write({ assignCount: (s.assignCount ?? 0) + 1 });
    },
    hintsActive,
    async tryShowTip(id, max = 1) {
      if (!(await hintsActive())) return false;
      const s = await read();
      const shown = s.tips?.[id] ?? 0;
      if (shown >= max) return false;
      await write({ tips: { ...s.tips, [id]: shown + 1 } });
      return true;
    },
    async replayIntro() {
      await write({ onboarded: false, installedAt: now(), assignCount: 0, tips: {} });
    },
  };
}
