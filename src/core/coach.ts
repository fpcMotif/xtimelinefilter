import {
  DECAY_ASSIGNS,
  DECAY_MS,
  isCoachCommand,
  transitionCoach,
  type CoachCommand,
  type CoachCommandResult,
  type TipId,
  type TipLimit,
} from "@/core/coach-domain";
import { requestCoach } from "@/core/protocol";
import { localArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { hasWorkerTransport as hasRuntimeTransport } from "@/core/worker-transport";

export { DECAY_ASSIGNS, DECAY_MS };
export type { TipId };

/** Cosmetic, fail-soft onboarding and decaying hints. */
export interface Coach {
  isOnboarded(): Promise<boolean>;
  markOnboarded(): Promise<void>;
  recordAssign(): Promise<void>;
  hintsActive(): Promise<boolean>;
  tryShowTip(id: TipId, max?: number): Promise<boolean>;
  replayIntro(): Promise<void>;
}

type RunCommand = (command: CoachCommand) => Promise<CoachCommandResult>;

/** Injected storage keeps tests and non-extension hosts on the same reducer. */
function localCommands(area: StorageLike, now: () => number): RunCommand {
  return async (command) => {
    const raw = (await area.get(STORAGE_KEYS.coach))[STORAGE_KEYS.coach];
    const transition = transitionCoach(raw, command, now());
    if (transition.changed) await area.set({ [STORAGE_KEYS.coach]: transition.stored });
    return transition.result;
  };
}

function isTipLimit(value: number): value is TipLimit {
  return value === 1 || value === 2 || value === 3;
}

function coachWith(run: RunCommand): Coach {
  let tail = Promise.resolve<unknown>(undefined);
  const command = (
    input: CoachCommand,
    fallback: CoachCommandResult,
  ): Promise<CoachCommandResult> => {
    const operation = (): Promise<CoachCommandResult> =>
      Promise.resolve()
        .then(() => run(input))
        .catch(() => fallback);
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined);
    return result;
  };

  return {
    async isOnboarded() {
      const result = await command(
        { kind: "is-onboarded" },
        { kind: "is-onboarded", onboarded: true },
      );
      return result.kind === "is-onboarded" ? result.onboarded : true;
    },
    async markOnboarded() {
      await command({ kind: "mark-onboarded" }, { kind: "ok" });
    },
    async recordAssign() {
      await command({ kind: "record-assign" }, { kind: "ok" });
    },
    async hintsActive() {
      const result = await command(
        { kind: "hints-active" },
        { kind: "hints-active", active: false },
      );
      return result.kind === "hints-active" ? result.active : false;
    },
    async tryShowTip(tip, max = 1) {
      if (!isTipLimit(max)) return false;
      const input = { kind: "try-show-tip" as const, tip, max };
      if (!isCoachCommand(input)) return false;
      const result = await command(input, { kind: "try-show-tip", show: false });
      return result.kind === "try-show-tip" ? result.show : false;
    },
    async replayIntro() {
      await command({ kind: "replay-intro" }, { kind: "ok" });
    },
  };
}

/** Extension contexts use worker commands; injected storage shares the reducer locally. */
export function createCoach(area?: StorageLike, now: () => number = Date.now): Coach {
  return coachWith(
    area
      ? localCommands(area, now)
      : hasRuntimeTransport()
        ? requestCoach
        : localCommands(localArea(), now),
  );
}
