import { blobStore, localArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";

/**
 * Onboarding + decaying-hint state (story beats 3 & 5). Hints are "decaying":
 * they show for 7 days or 5 assigns, whichever comes first, then the UI returns
 * to pure camouflage. "Replay intro" in Settings resets everything for a second
 * pass. Persisted under `lasso:coach` in chrome.storage.local.
 *
 * Coach is cosmetic and best-effort. Its profile-wide storage can race across
 * extension contexts, so exact counts are not an invariant. Product actions
 * never depend on coaching state.
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

export function createCoach(area: StorageLike = localArea(), now: () => number = Date.now): Coach {
  const store = blobStore<CoachState>(area, STORAGE_KEYS.coach, {});
  let mutationTail: Promise<void> = Promise.resolve();

  /** Keep read-modify-write updates ordered within this Coach instance. */
  function mutate<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.catch(() => fallback);
  }

  function activeHints(state: CoachState & { installedAt: number }): boolean {
    if ((state.assignCount ?? 0) >= DECAY_ASSIGNS) return false;
    return now() - state.installedAt <= DECAY_MS;
  }

  function stampInstalledAt(state: CoachState): CoachState & { installedAt: number } {
    return state.installedAt === undefined
      ? { ...state, installedAt: now() }
      : (state as CoachState & { installedAt: number });
  }

  function write(next: CoachState): Promise<CoachState> {
    return store.set(next);
  }

  function hintsActive(): Promise<boolean> {
    return mutate(async () => {
      const state = await store.get();
      const withInstalledAt = stampInstalledAt(state);
      if (withInstalledAt !== state) await write(withInstalledAt);
      return activeHints(withInstalledAt);
    }, false);
  }

  return {
    async isOnboarded() {
      try {
        return (await store.get()).onboarded === true;
      } catch {
        // A missing answer must not show onboarding on every boot.
        return true;
      }
    },
    async markOnboarded() {
      await mutate(async () => {
        const state = await store.get();
        await write({ ...state, onboarded: true });
      }, undefined);
    },
    async recordAssign() {
      await mutate(async () => {
        const state = await store.get();
        await write({ ...state, assignCount: (state.assignCount ?? 0) + 1 });
      }, undefined);
    },
    hintsActive,
    async tryShowTip(id, max = 1) {
      return mutate(async () => {
        const state = await store.get();
        const withInstalledAt = stampInstalledAt(state);
        if (!activeHints(withInstalledAt)) return false;
        const shown = withInstalledAt.tips?.[id] ?? 0;
        if (shown >= max) return false;
        await write({
          ...withInstalledAt,
          tips: { ...withInstalledAt.tips, [id]: shown + 1 },
        });
        return true;
      }, false);
    },
    async replayIntro() {
      await mutate(async () => {
        const state = await store.get();
        await write({ ...state, onboarded: false, installedAt: now(), assignCount: 0, tips: {} });
      }, undefined);
    },
  };
}
