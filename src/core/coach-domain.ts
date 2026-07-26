/**
 * Pure, bounded authority for onboarding and decaying coaching hints.
 * Transport and persistence live outside this module.
 */

export const DECAY_MS = 7 * 24 * 60 * 60 * 1000;
export const DECAY_ASSIGNS = 5;
export const MAX_TIP_IMPRESSIONS = 3;

export const COACH_TIP_IDS = ["first-hover", "unit", "select-nudge", "post-assign"] as const;

export type TipId = (typeof COACH_TIP_IDS)[number];
export type TipLimit = 1 | 2 | 3;

/** Canonical storage form. Counts are bounded because only thresholds matter. */
export interface CoachState {
  onboarded: boolean;
  installedAt?: number;
  assignCount: number;
  tips: Partial<Record<TipId, number>>;
}

/** Semantic commands; callers never submit a raw CoachState or a timestamp. */
export type CoachCommand =
  | { kind: "is-onboarded" }
  | { kind: "mark-onboarded" }
  | { kind: "record-assign" }
  | { kind: "hints-active" }
  | { kind: "try-show-tip"; tip: TipId; max: TipLimit }
  | { kind: "replay-intro" };

export type CoachCommandResult =
  | { kind: "is-onboarded"; onboarded: boolean }
  | { kind: "hints-active"; active: boolean }
  | { kind: "try-show-tip"; show: boolean }
  | { kind: "ok" };

export interface CoachTransition {
  /** Canonical state to persist when `changed` is true. */
  stored: CoachState;
  /** True only when this command changed durable state. */
  changed: boolean;
  result: CoachCommandResult;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const has = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isTipId = (value: unknown): value is TipId =>
  typeof value === "string" && COACH_TIP_IDS.includes(value as TipId);

const isTipLimit = (value: unknown): value is TipLimit => value === 1 || value === 2 || value === 3;

const boundedCount = (value: unknown, maximum: number): number =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? Math.min(value as number, maximum) : 0;

/** Unknown and malformed storage never escapes this boundary. */
export function normalizeCoach(raw: unknown): CoachState {
  const source = isRecord(raw) ? raw : {};
  const rawTips = isRecord(source.tips) ? source.tips : {};
  const tips: Partial<Record<TipId, number>> = {};

  for (const id of COACH_TIP_IDS) {
    const count = boundedCount(rawTips[id], MAX_TIP_IMPRESSIONS);
    if (count > 0) tips[id] = count;
  }

  return {
    onboarded: source.onboarded === true,
    installedAt:
      Number.isSafeInteger(source.installedAt) && (source.installedAt as number) >= 0
        ? (source.installedAt as number)
        : undefined,
    assignCount: boundedCount(source.assignCount, DECAY_ASSIGNS),
    tips,
  };
}

export function isCoachCommand(value: unknown): value is CoachCommand {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "is-onboarded":
    case "mark-onboarded":
    case "record-assign":
    case "hints-active":
    case "replay-intro":
      return Object.keys(value).length === 1;
    case "try-show-tip":
      return (
        Object.keys(value).length === 3 &&
        has(value, "tip") &&
        has(value, "max") &&
        isTipId(value.tip) &&
        isTipLimit(value.max)
      );
    default:
      return false;
  }
}

/** The current product contract: exactly seven days is still inside the window. */
export function coachHintsActive(state: CoachState, now: number): boolean {
  const age = state.installedAt === undefined ? null : now - state.installedAt;
  return age !== null && age >= 0 && state.assignCount < DECAY_ASSIGNS && age <= DECAY_MS;
}

const sameState = (left: CoachState, right: CoachState): boolean =>
  left.onboarded === right.onboarded &&
  left.installedAt === right.installedAt &&
  left.assignCount === right.assignCount &&
  COACH_TIP_IDS.every((id) => left.tips[id] === right.tips[id]);

const stamped = (state: CoachState, now: number): CoachState =>
  state.installedAt === undefined || state.installedAt > now
    ? { ...state, installedAt: now }
    : state;

const transition = (
  current: CoachState,
  stored: CoachState,
  result: CoachCommandResult,
): CoachTransition => ({
  stored,
  changed: !sameState(current, stored),
  result,
});

/**
 * One serialized worker call applies one command to its immediate predecessor.
 * `now` comes from the authority, never the wire caller.
 */
export function transitionCoach(raw: unknown, command: CoachCommand, now: number): CoachTransition {
  const current = normalizeCoach(raw);

  switch (command.kind) {
    case "is-onboarded":
      return transition(current, current, {
        kind: "is-onboarded",
        onboarded: current.onboarded,
      });
    case "mark-onboarded":
      return transition(current, { ...current, onboarded: true }, { kind: "ok" });
    case "record-assign":
      return transition(
        current,
        {
          ...current,
          assignCount: Math.min(DECAY_ASSIGNS, current.assignCount + 1),
        },
        { kind: "ok" },
      );
    case "hints-active": {
      const next = stamped(current, now);
      return transition(current, next, {
        kind: "hints-active",
        active: coachHintsActive(next, now),
      });
    }
    case "try-show-tip": {
      const eligible = stamped(current, now);
      if (!coachHintsActive(eligible, now)) {
        // Match the prior behavior: a declined tip does not stamp installation.
        return transition(current, current, {
          kind: "try-show-tip",
          show: false,
        });
      }
      const shown = eligible.tips[command.tip] ?? 0;
      if (shown >= command.max) {
        return transition(current, current, {
          kind: "try-show-tip",
          show: false,
        });
      }
      return transition(
        current,
        {
          ...eligible,
          tips: { ...eligible.tips, [command.tip]: shown + 1 },
        },
        { kind: "try-show-tip", show: true },
      );
    }
    case "replay-intro":
      return transition(
        current,
        { onboarded: false, installedAt: now, assignCount: 0, tips: {} },
        { kind: "ok" },
      );
  }
}
