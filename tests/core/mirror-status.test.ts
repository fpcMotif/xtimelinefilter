import { describe, expect, it, vi } from "vitest";

import { createMirrorStatusStore, mirrorAgeLabel, parseMirrorStatus } from "@/core/mirror-status";
import type { StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { createMemoryArea, installOnChanged } from "../helpers/chrome-fake";

describe("parseMirrorStatus", () => {
  it("accepts a well-formed tagged status", () => {
    expect(parseMirrorStatus({ ok: true, at: 123, configId: "mirror-1" })).toEqual({
      ok: true,
      at: 123,
      configId: "mirror-1",
    });
    expect(parseMirrorStatus({ ok: false, at: 0, configId: "mirror-2", extra: "ignored" })).toEqual(
      {
        ok: false,
        at: 0,
        configId: "mirror-2",
      },
    );
  });

  it("rejects old untagged rows and anything malformed", () => {
    expect(parseMirrorStatus(null)).toBeNull();
    expect(parseMirrorStatus(undefined)).toBeNull();
    expect(parseMirrorStatus("synced")).toBeNull();
    expect(parseMirrorStatus({ ok: "yes", at: 1 })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: "now" })).toBeNull();
    expect(parseMirrorStatus({ ok: true })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: 1 })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: 1, configId: "" })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: 1, configId: "   " })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: -1, configId: "mirror-1" })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: Number.NaN, configId: "mirror-1" })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: Infinity, configId: "mirror-1" })).toBeNull();
  });
});

describe("mirrorAgeLabel", () => {
  const now = Date.UTC(2026, 6, 2, 12, 0, 0);

  it("labels sub-minute ages as just now (clock skew clamps to zero)", () => {
    expect(mirrorAgeLabel(now - 30_000, now)).toBe("just now");
    expect(mirrorAgeLabel(now + 5_000, now)).toBe("just now"); // future stamp: skew, not time travel
  });

  it("labels minute and hour ages", () => {
    expect(mirrorAgeLabel(now - 3 * 60_000, now)).toBe("3m ago");
    expect(mirrorAgeLabel(now - 59 * 60_000, now)).toBe("59m ago");
    expect(mirrorAgeLabel(now - 2 * 3_600_000, now)).toBe("2h ago");
  });
});

describe("createMirrorStatusStore", () => {
  it("defaults to chrome.storage.local", async () => {
    const store = createMirrorStatusStore();
    await store.publish({ ok: true, at: 5, configId: "mirror-1" });
    expect(await store.read()).toEqual({ ok: true, at: 5, configId: "mirror-1" });
  });

  it("read() returns null when nothing has been published", async () => {
    const store = createMirrorStatusStore(createMemoryArea());
    expect(await store.read()).toBeNull();
  });

  it("publish() then read() round-trips under STORAGE_KEYS.mirrorStatus, value shape unchanged", async () => {
    const area = createMemoryArea();
    const store = createMirrorStatusStore(area);
    await store.publish({ ok: true, at: 42, configId: "mirror-1" });
    expect(area.data[STORAGE_KEYS.mirrorStatus]).toEqual({
      ok: true,
      at: 42,
      configId: "mirror-1",
    });
    expect(await store.read()).toEqual({ ok: true, at: 42, configId: "mirror-1" });
  });

  it("read() returns null for a malformed stored value", async () => {
    const area = createMemoryArea({ [STORAGE_KEYS.mirrorStatus]: "not a status" });
    const store = createMirrorStatusStore(area);
    expect(await store.read()).toBeNull();
  });

  it("publish() never throws when storage rejects (fail-soft, ADR-0009)", async () => {
    const area: StorageLike = {
      get: async () => ({}),
      set: () => Promise.reject(new Error("boom")),
    };
    const store = createMirrorStatusStore(area);
    await expect(
      store.publish({ ok: false, at: 1, configId: "mirror-1" }),
    ).resolves.toBeUndefined();
  });

  it("read() returns null when storage rejects", async () => {
    const area: StorageLike = {
      get: () => Promise.reject(new Error("boom")),
      set: async () => {},
    };
    const store = createMirrorStatusStore(area);
    expect(await store.read()).toBeNull();
  });

  it("subscribes to tagged local changes, rejects malformed rows, and disposes", () => {
    const bridge = installOnChanged();
    try {
      const store = createMirrorStatusStore(createMemoryArea());
      const seen = vi.fn();
      const dispose = store.subscribe(seen);
      const status = { ok: false, at: 7, configId: "mirror-1" };

      bridge.emit(STORAGE_KEYS.mirrorStatus, status, "sync");
      expect(seen).not.toHaveBeenCalled();
      bridge.emit(STORAGE_KEYS.mirrorStatus, status, "local");
      bridge.emit(STORAGE_KEYS.mirrorStatus, { ok: true, at: 8 }, "local", status);
      expect(seen).toHaveBeenNthCalledWith(1, status);
      expect(seen).toHaveBeenNthCalledWith(2, null);

      dispose();
      dispose();
      bridge.emit(STORAGE_KEYS.mirrorStatus, status, "local");
      expect(seen).toHaveBeenCalledTimes(2);
    } finally {
      bridge.restore();
    }
  });

  it("keeps watching for the survivors when one of several subscribers disposes", () => {
    const bridge = installOnChanged();
    try {
      const store = createMirrorStatusStore(createMemoryArea());
      const first = vi.fn();
      const second = vi.fn();
      const disposeFirst = store.subscribe(first);
      store.subscribe(second);
      const status = { ok: true, at: 9, configId: "mirror-1" };

      disposeFirst();
      bridge.emit(STORAGE_KEYS.mirrorStatus, status, "local");

      // subscribers.size is still 1, so the underlying watch is NOT torn down.
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(status);
    } finally {
      bridge.restore();
    }
  });
});
