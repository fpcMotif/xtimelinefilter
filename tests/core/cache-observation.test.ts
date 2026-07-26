import { describe, expect, it } from "vitest";

import {
  beginCacheObservation,
  compareCacheObservations,
  decideCacheObservation,
  isCacheObservation,
  MAX_CACHE_OBSERVATION_SEQUENCE,
  normalizeCacheObservation,
  normalizeCacheObservationClock,
  rotateCacheObservationClock,
} from "@/core/cache-observation";

const EPOCH_A = "00000000-0000-4000-8000-000000000001";
const EPOCH_B = "00000000-0000-4000-8000-000000000002";
const EPOCH_C = "00000000-0000-4000-8000-000000000003";

describe("cache observation clock", () => {
  it("rejects malformed or unbounded wire tokens", () => {
    expect(normalizeCacheObservation(null)).toBeNull();
    expect(normalizeCacheObservation({ epoch: "not-a-uuid", sequence: 1 })).toBeNull();
    expect(normalizeCacheObservation({ epoch: EPOCH_A, sequence: -1 })).toBeNull();
    expect(
      normalizeCacheObservation({ epoch: EPOCH_A, sequence: MAX_CACHE_OBSERVATION_SEQUENCE + 1 }),
    ).toBeNull();
    expect(normalizeCacheObservation({ epoch: EPOCH_A, sequence: 1.5 })).toBeNull();
    expect(isCacheObservation({ epoch: EPOCH_A, sequence: 1, unexpected: "field" })).toBe(false);
  });

  it("keeps a valid persisted clock across a worker restart", () => {
    const persisted = { schema: 1, epoch: EPOCH_A, sequence: 41 };

    expect(normalizeCacheObservationClock(persisted, () => EPOCH_B)).toEqual(persisted);
    expect(beginCacheObservation(persisted, () => EPOCH_B)).toEqual({
      clock: { ...persisted, sequence: 42 },
      observation: { epoch: EPOCH_A, sequence: 42 },
    });
  });

  it("replaces malformed persisted clocks with a fresh UUID epoch", () => {
    expect(
      normalizeCacheObservationClock({ schema: 1, epoch: "bad", sequence: 0 }, () => EPOCH_A),
    ).toEqual({
      schema: 1,
      epoch: EPOCH_A,
      sequence: 0,
    });
    expect(() => normalizeCacheObservationClock(null, () => "bad")).toThrow(
      "cache epoch generator must return a UUID",
    );
  });

  it("issues monotonically newer observations from the persisted transition", () => {
    const first = beginCacheObservation({ schema: 1, epoch: EPOCH_A, sequence: 0 }, () => EPOCH_B);
    const second = beginCacheObservation(first.clock, () => EPOCH_B);

    expect(first.observation).toEqual({ epoch: EPOCH_A, sequence: 1 });
    expect(second.observation).toEqual({ epoch: EPOCH_A, sequence: 2 });
    expect(compareCacheObservations(first.observation, second.observation)).toBe(-1);
  });

  it("rotates before numeric exhaustion and resumes at one", () => {
    const transition = beginCacheObservation(
      { schema: 1, epoch: EPOCH_A, sequence: MAX_CACHE_OBSERVATION_SEQUENCE },
      () => EPOCH_B,
    );

    expect(transition).toEqual({
      clock: { schema: 1, epoch: EPOCH_B, sequence: 1 },
      observation: { epoch: EPOCH_B, sequence: 1 },
    });
  });

  it("fences pre-clear work by rotating the opaque epoch", () => {
    const beforeClear = beginCacheObservation(
      { schema: 1, epoch: EPOCH_A, sequence: 3 },
      () => EPOCH_B,
    );
    const cleared = rotateCacheObservationClock(beforeClear.clock, () => EPOCH_B);
    const afterClear = beginCacheObservation(cleared, () => EPOCH_C);

    expect(cleared).toEqual({ schema: 1, epoch: EPOCH_B, sequence: 0 });
    expect(afterClear.observation).toEqual({ epoch: EPOCH_B, sequence: 1 });
    expect(compareCacheObservations(beforeClear.observation, afterClear.observation)).toBeNull();
  });

  it("compares only same-epoch observations", () => {
    const first = { epoch: EPOCH_A, sequence: 1 };
    const second = { epoch: EPOCH_A, sequence: 2 };

    expect(compareCacheObservations(second, first)).toBe(1);
    expect(compareCacheObservations(first, first)).toBe(0);
    expect(compareCacheObservations(first, { epoch: EPOCH_B, sequence: 1 })).toBeNull();
    expect(compareCacheObservations(first, { epoch: EPOCH_A, sequence: -1 })).toBeNull();
  });

  it("keeps only current-epoch rows and lets their newest issued write win", () => {
    const clock = { epoch: EPOCH_B, sequence: 3 };

    expect(decideCacheObservation(clock, { epoch: EPOCH_A, sequence: 3 })).toBe("empty");
    expect(
      decideCacheObservation(
        clock,
        { epoch: EPOCH_A, sequence: 3 },
        { epoch: EPOCH_A, sequence: 3 },
      ),
    ).toBe("empty");
    expect(decideCacheObservation(clock, { epoch: EPOCH_B, sequence: 3 })).toBe("existing");
    expect(
      decideCacheObservation(
        clock,
        { epoch: EPOCH_B, sequence: 3 },
        { epoch: EPOCH_B, sequence: 2 },
      ),
    ).toBe("existing");
    expect(
      decideCacheObservation(
        clock,
        { epoch: EPOCH_B, sequence: 2 },
        { epoch: EPOCH_B, sequence: 3 },
      ),
    ).toBe("write");
    expect(
      decideCacheObservation(
        clock,
        { epoch: EPOCH_A, sequence: 3 },
        { epoch: EPOCH_B, sequence: 4 },
      ),
    ).toBe("empty");
    expect(
      decideCacheObservation(clock, { epoch: EPOCH_B, sequence: 2 }, { epoch: "bad", sequence: 1 }),
    ).toBe("existing");
  });

  it("rejects a UUID generator that cannot create a new fence", () => {
    expect(() =>
      rotateCacheObservationClock({ schema: 1, epoch: EPOCH_A, sequence: 0 }, () => EPOCH_A),
    ).toThrow("cache epoch generator must rotate the UUID");
  });
});
