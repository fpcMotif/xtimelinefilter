import { describe, expect, it, vi } from "vitest";

import { createListUsage, createWorkerListUsagePort, type ListUsage } from "@/core/list-usage";
import * as protocol from "@/core/protocol";

function usagePort(overrides: Partial<ListUsage> = {}): ListUsage {
  return {
    record: vi.fn(async () => {}),
    recentIds: vi.fn(async () => []),
    ...overrides,
  };
}

describe("createListUsage", () => {
  it("uses Chrome transport for record and recent history", async () => {
    const sendMessage = vi.fn(async (request: { operation: string }) =>
      request.operation === "recent" ? { ok: true, listIds: ["2", "1"] } : { ok: true },
    );
    const previous = globalThis.chrome;
    globalThis.chrome = { ...previous, runtime: { sendMessage } } as unknown as typeof chrome;
    try {
      const port = createWorkerListUsagePort();

      await expect(port.record("1", "2")).resolves.toBeUndefined();
      await expect(port.recentIds("1", 2)).resolves.toEqual(["2", "1"]);
      expect(sendMessage).toHaveBeenNthCalledWith(1, {
        type: "lasso:list-usage",
        operation: "record",
        ownerUserId: "1",
        listId: "2",
      });
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("treats a missing recent-history field as empty", async () => {
    vi.spyOn(protocol, "requestListUsage").mockResolvedValue({ ok: true });

    await expect(createWorkerListUsagePort().recentIds("1", 1)).resolves.toEqual([]);
  });

  it("delegates picker history to its semantic port", async () => {
    const port = usagePort({ recentIds: vi.fn(async () => ["2", "1"]) });
    const usage = createListUsage(port);

    await usage.record("1", "2");
    await expect(usage.recentIds("1", 5)).resolves.toEqual(["2", "1"]);
    expect(port.record).toHaveBeenCalledWith("1", "2");
    expect(port.recentIds).toHaveBeenCalledWith("1", 5);
  });

  it("fails soft when picker history is unavailable", async () => {
    const port = usagePort({
      record: vi.fn(async () => {
        throw new Error("down");
      }),
      recentIds: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const usage = createListUsage(port);

    await expect(usage.record("1", "2")).resolves.toBeUndefined();
    await expect(usage.recentIds("1", 5)).resolves.toEqual([]);
  });
});
