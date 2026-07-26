import { requestListUsage } from "@/core/protocol";
import { STORAGE_KEYS } from "@/core/storage-keys";

export const LIST_USAGE_PREFIX = `${STORAGE_KEYS.listUsage}:`;

export interface ListUsage {
  record(ownerUserId: string, listId: string): Promise<void>;
  recentIds(ownerUserId: string, limit: number): Promise<string[]>;
}

/** Worker-owned usage operations. Fakes model picker history, never storage. */
export function createWorkerListUsagePort(): ListUsage {
  return {
    async record(ownerUserId, listId) {
      await requestListUsage({
        type: "lasso:list-usage",
        operation: "record",
        ownerUserId,
        listId,
      });
    },
    async recentIds(ownerUserId, limit) {
      const response = await requestListUsage({
        type: "lasso:list-usage",
        operation: "recent",
        ownerUserId,
        limit,
      });
      return "listIds" in response && response.listIds ? response.listIds : [];
    },
  };
}

/** Picker history is a hint: transport failures are never user-visible. */
export function createListUsage(port: ListUsage = createWorkerListUsagePort()): ListUsage {
  return {
    async record(ownerUserId, listId) {
      try {
        await port.record(ownerUserId, listId);
      } catch {
        // Usage is a picker hint, never a user-visible failure.
      }
    },
    async recentIds(ownerUserId, limit) {
      try {
        return await port.recentIds(ownerUserId, limit);
      } catch {
        return [];
      }
    },
  };
}
