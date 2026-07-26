import type { StorageLike } from "@/core/storage-areas";

const tails = new WeakMap<StorageLike, Promise<void>>();

/** Serializes composite operations for one worker-owned storage area. */
export function serializeWorkerStorage<T>(
  area: StorageLike,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(area) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  tails.set(
    area,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
