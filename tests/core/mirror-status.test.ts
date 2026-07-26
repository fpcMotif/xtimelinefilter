import { describe, expect, it, vi } from "vitest";

import {
  createMirrorStatusStore,
  createWorkerMirrorStatusPort,
  mirrorAgeLabel,
  parseMirrorStatus,
  type MirrorStatus,
  type MirrorStatusPort,
} from "@/core/mirror-status";
import * as protocol from "@/core/protocol";

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;

function statusPort(overrides: Partial<MirrorStatusPort> = {}): MirrorStatusPort {
  return {
    report: vi.fn(async () => {}),
    read: vi.fn(async () => null),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  };
}

describe("parseMirrorStatus", () => {
  it("accepts a complete status", () => {
    expect(parseMirrorStatus({ ok: true, at: 1, configId: "mirror-1" })).toEqual({
      ok: true,
      at: 1,
      configId: "mirror-1",
    });
  });

  it.each([
    null,
    {},
    { ok: "yes", at: 1, configId: "id" },
    { ok: true, at: Number.NaN, configId: "id" },
    { ok: true, at: -1, configId: "id" },
    { ok: true, at: 1, configId: "   " },
    { ok: true, at: 1, configId: "x".repeat(257) },
    { ok: true, at: 1 },
  ])("rejects malformed values", (value) => expect(parseMirrorStatus(value)).toBeNull());
});

describe("mirrorAgeLabel", () => {
  it.each([
    [0, 0, "just now"],
    [0, 180_000, "3m ago"],
    [0, 7_200_000, "2h ago"],
  ])("renders %s / %s", (at, now, expected) => {
    expect(mirrorAgeLabel(at, now)).toBe(expected);
  });
});

describe("createMirrorStatusStore", () => {
  it("uses Chrome transport and parses storage status updates", async () => {
    const sendMessage = vi.fn(async (request: { operation: string }) =>
      request.operation === "read"
        ? { ok: true, status: { ok: true, at: 1, configId: "mirror-1" } }
        : { ok: true },
    );
    const listeners = new Set<StorageChangeListener>();
    const previous = globalThis.chrome;
    globalThis.chrome = {
      ...previous,
      runtime: { sendMessage },
      storage: {
        ...previous.storage,
        onChanged: {
          addListener: (listener: StorageChangeListener) => listeners.add(listener),
          removeListener: (listener: StorageChangeListener) => listeners.delete(listener),
        },
      },
    } as unknown as typeof chrome;
    try {
      const port = createWorkerMirrorStatusPort();
      const seen = vi.fn();
      const stop = port.subscribe(seen);

      await expect(port.report({ ok: false, configId: "mirror-1" })).resolves.toBeUndefined();
      await expect(port.read()).resolves.toEqual({ ok: true, at: 1, configId: "mirror-1" });
      for (const listener of listeners)
        listener(
          { "lasso:mirror-status": { newValue: { ok: false, at: 2, configId: "mirror-2" } } },
          "local",
        );
      stop();
      expect(seen).toHaveBeenCalledWith({ ok: false, at: 2, configId: "mirror-2" });
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("treats a missing worker status as unset", async () => {
    vi.spyOn(protocol, "requestMirrorStatus").mockResolvedValue({ ok: true });

    await expect(createWorkerMirrorStatusPort().read()).resolves.toBeNull();
  });

  it("delegates read and publish through its semantic port", async () => {
    const status: MirrorStatus = { ok: true, at: 1, configId: "mirror-1" };
    const port = statusPort({ read: vi.fn(async () => status) });
    const store = createMirrorStatusStore(port);

    await store.publish({ ok: true, configId: "mirror-1" });
    await expect(store.read()).resolves.toEqual(status);
    expect(port.report).toHaveBeenCalledWith({ ok: true, configId: "mirror-1" });
  });

  it("fails soft when the worker is unavailable", async () => {
    const port = statusPort({
      report: vi.fn(async () => {
        throw new Error("down");
      }),
      read: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const store = createMirrorStatusStore(port);

    await expect(store.publish({ ok: false, configId: "mirror-1" })).resolves.toBeUndefined();
    await expect(store.read()).resolves.toBeNull();
  });

  it("fans one semantic subscription to active listeners", () => {
    let publish!: (status: MirrorStatus | null) => void;
    const unsubscribe = vi.fn();
    const port = statusPort({
      subscribe: vi.fn((listener) => {
        publish = listener;
        return unsubscribe;
      }),
    });
    const store = createMirrorStatusStore(port);
    const first = vi.fn(() => {
      throw new Error("cosmetic surface failed");
    });
    const second = vi.fn();
    const stopFirst = store.subscribe(first);
    const stopSecond = store.subscribe(second);

    publish({ ok: false, at: 7, configId: "mirror-1" });
    stopFirst();
    stopFirst();
    stopSecond();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(port.subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
