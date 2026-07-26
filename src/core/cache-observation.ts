/** Durable fence for async cache writes. Epochs are opaque UUIDs; sequences order one epoch. */
export interface CacheObservation {
  epoch: string;
  sequence: number;
}

/** Persist this value beside cache data so a worker restart retains its ordering fence. */
export interface CacheObservationClock extends CacheObservation {
  schema: 1;
}

export interface CacheObservationTransition {
  clock: CacheObservationClock;
  observation: CacheObservation;
}

export type CacheObservationOrder = -1 | 0 | 1 | null;
export type CacheObservationDecision = "write" | "existing" | "empty";

export const MAX_CACHE_OBSERVATION_SEQUENCE = Number.MAX_SAFE_INTEGER;

const CACHE_OBSERVATION_SCHEMA = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isEpoch = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const isSequence = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_CACHE_OBSERVATION_SEQUENCE;

/** Validates the exact token shape accepted at trust boundaries. */
export function isCacheObservation(value: unknown): value is CacheObservation {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, "epoch") &&
    Object.hasOwn(value, "sequence") &&
    isEpoch(value.epoch) &&
    isSequence(value.sequence)
  );
}

function generatedEpoch(makeUuid: () => string, previous?: string): string {
  const epoch = makeUuid();
  if (!isEpoch(epoch)) throw new TypeError("cache epoch generator must return a UUID");
  if (epoch === previous) throw new TypeError("cache epoch generator must rotate the UUID");
  return epoch;
}

/** Parses an untrusted cache token. Different epochs have no artificial ordering. */
export function normalizeCacheObservation(value: unknown): CacheObservation | null {
  if (!isCacheObservation(value)) return null;
  return { epoch: value.epoch, sequence: value.sequence };
}

/** Parses a persisted clock, replacing malformed state with a new epoch at sequence zero. */
export function normalizeCacheObservationClock(
  value: unknown,
  makeUuid: () => string,
): CacheObservationClock {
  if (!isRecord(value) || value.schema !== CACHE_OBSERVATION_SCHEMA) {
    return { schema: CACHE_OBSERVATION_SCHEMA, epoch: generatedEpoch(makeUuid), sequence: 0 };
  }
  return isEpoch(value.epoch) && isSequence(value.sequence)
    ? { schema: CACHE_OBSERVATION_SCHEMA, epoch: value.epoch, sequence: value.sequence }
    : { schema: CACHE_OBSERVATION_SCHEMA, epoch: generatedEpoch(makeUuid), sequence: 0 };
}

/** Issues the next token. Sequence exhaustion rotates the epoch before issuing again. */
export function beginCacheObservation(
  value: unknown,
  makeUuid: () => string,
): CacheObservationTransition {
  const clock = normalizeCacheObservationClock(value, makeUuid);
  const next: CacheObservationClock =
    clock.sequence === MAX_CACHE_OBSERVATION_SEQUENCE
      ? {
          schema: CACHE_OBSERVATION_SCHEMA,
          epoch: generatedEpoch(makeUuid, clock.epoch),
          sequence: 1,
        }
      : { ...clock, sequence: clock.sequence + 1 };
  return { clock: next, observation: { epoch: next.epoch, sequence: next.sequence } };
}

/** Privacy clear changes the epoch, permanently fencing work that began before it. */
export function rotateCacheObservationClock(
  value: unknown,
  makeUuid: () => string,
): CacheObservationClock {
  const clock = normalizeCacheObservationClock(value, makeUuid);
  return {
    schema: CACHE_OBSERVATION_SCHEMA,
    epoch: generatedEpoch(makeUuid, clock.epoch),
    sequence: 0,
  };
}

/** Orders two valid tokens from one epoch. Null means malformed or cross-epoch. */
export function compareCacheObservations(left: unknown, right: unknown): CacheObservationOrder {
  const a = normalizeCacheObservation(left);
  const b = normalizeCacheObservation(right);
  if (!a || !b || a.epoch !== b.epoch) return null;
  return a.sequence === b.sequence ? 0 : a.sequence < b.sequence ? -1 : 1;
}

/** Decides whether a cache row is current, wins a write race, or must stay fenced. */
export function decideCacheObservation(
  clock: CacheObservation,
  existing: unknown,
  attempted?: unknown,
): CacheObservationDecision {
  const stored = normalizeCacheObservation(existing);
  const current =
    stored !== null && stored.epoch === clock.epoch && stored.sequence <= clock.sequence;
  if (attempted === undefined) return current ? "existing" : "empty";

  const token = normalizeCacheObservation(attempted);
  if (!token || token.epoch !== clock.epoch || token.sequence > clock.sequence)
    return current ? "existing" : "empty";
  return current && compareCacheObservations(stored, token) === 1 ? "existing" : "write";
}
