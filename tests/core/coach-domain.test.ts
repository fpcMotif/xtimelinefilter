import { describe, expect, it } from "vitest";

import {
  COACH_TIP_IDS,
  DECAY_ASSIGNS,
  DECAY_MS,
  coachHintsActive,
  isCoachCommand,
  normalizeCoach,
  transitionCoach,
} from "@/core/coach-domain";

const T0 = Date.UTC(2026, 5, 1);

describe("coach domain", () => {
  it("normalizes malformed values and caps threshold-only counts", () => {
    expect(
      normalizeCoach({
        onboarded: "yes",
        installedAt: -1,
        assignCount: 99,
        tips: { unit: 99, "first-hover": -1, unknown: 1 },
        unknown: true,
      }),
    ).toEqual({
      onboarded: false,
      installedAt: undefined,
      assignCount: DECAY_ASSIGNS,
      tips: { unit: 3 },
    });
  });

  it("keeps the existing inclusive seven-day boundary", () => {
    const state = normalizeCoach({ installedAt: T0 });

    expect(coachHintsActive(state, T0 + DECAY_MS)).toBe(true);
    expect(coachHintsActive(state, T0 + DECAY_MS + 1)).toBe(false);
  });

  it("keeps hints inactive without an install stamp or when the worker clock moved back", () => {
    expect(coachHintsActive(normalizeCoach({}), T0)).toBe(false);
    expect(coachHintsActive(normalizeCoach({ installedAt: T0 + 1 }), T0)).toBe(false);
  });

  it("repairs a future installation stamp against the worker clock", () => {
    expect(
      transitionCoach({ installedAt: Number.MAX_SAFE_INTEGER }, { kind: "hints-active" }, T0),
    ).toMatchObject({
      changed: true,
      stored: { installedAt: T0 },
      result: { kind: "hints-active", active: true },
    });
  });

  it("stamps hints, but a declined tip alone does not stamp installation", () => {
    const exhausted = { assignCount: DECAY_ASSIGNS };

    expect(transitionCoach(exhausted, { kind: "try-show-tip", tip: "unit", max: 3 }, T0)).toEqual({
      stored: {
        onboarded: false,
        installedAt: undefined,
        assignCount: DECAY_ASSIGNS,
        tips: {},
      },
      changed: false,
      result: { kind: "try-show-tip", show: false },
    });
    expect(transitionCoach({}, { kind: "hints-active" }, T0)).toMatchObject({
      changed: true,
      stored: { installedAt: T0 },
      result: { kind: "hints-active", active: true },
    });
  });

  it("saturates assigns at the decay threshold", () => {
    const fourth = { assignCount: DECAY_ASSIGNS - 1 };
    const fifth = transitionCoach(fourth, { kind: "record-assign" }, T0);
    const later = transitionCoach(fifth.stored, { kind: "record-assign" }, T0);

    expect(fifth.stored.assignCount).toBe(DECAY_ASSIGNS);
    expect(fifth.changed).toBe(true);
    expect(later.stored.assignCount).toBe(DECAY_ASSIGNS);
    expect(later.changed).toBe(false);
  });

  it("makes the check-and-consume tip decision atomic in reducer order", () => {
    const first = transitionCoach({}, { kind: "try-show-tip", tip: "first-hover", max: 1 }, T0);
    const second = transitionCoach(
      first.stored,
      { kind: "try-show-tip", tip: "first-hover", max: 1 },
      T0,
    );

    expect(first.result).toEqual({ kind: "try-show-tip", show: true });
    expect(second.result).toEqual({ kind: "try-show-tip", show: false });
  });

  it("replay restores onboarding and every bounded tip", () => {
    const replay = transitionCoach(
      {
        onboarded: true,
        installedAt: 1,
        assignCount: 5,
        tips: Object.fromEntries(COACH_TIP_IDS.map((id) => [id, 3])),
      },
      { kind: "replay-intro" },
      T0,
    );

    expect(replay).toEqual({
      stored: { onboarded: false, installedAt: T0, assignCount: 0, tips: {} },
      changed: true,
      result: { kind: "ok" },
    });
  });

  it("admits only bounded semantic commands", () => {
    expect(isCoachCommand({ kind: "try-show-tip", tip: "unit", max: 3 })).toBe(true);
    for (const invalid of [
      { kind: "try-show-tip", tip: "unit", max: 4 },
      { kind: "try-show-tip", tip: "unknown", max: 1 },
      { kind: "record-assign", raw: {} },
      { kind: "hints-active", now: T0 },
      { kind: "unknown" },
    ]) {
      expect(isCoachCommand(invalid)).toBe(false);
    }
    expect(isCoachCommand(null)).toBe(false);
    expect(isCoachCommand({ kind: 1 })).toBe(false);
    expect(isCoachCommand({ kind: "mark-onboarded" })).toBe(true);
    expect(isCoachCommand({ kind: "is-onboarded" })).toBe(true);
    expect(isCoachCommand({ kind: "replay-intro" })).toBe(true);
  });
});
