import { describe, expect, it } from "vitest";

import { createMirrorStatusStore, mirrorAgeLabel, parseMirrorStatus } from "@/core/mirror-status";
import type { StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { createMemoryArea } from "../helpers/chrome-fake";

describe("parseMirrorStatus", () => {
  it("accepts a well-formed {ok, at} record", () => {
    expect(parseMirrorStatus({ ok: true, at: 123 })).toEqual({ ok: true, at: 123 });
    expect(parseMirrorStatus({ ok: false, at: 0, extra: "ignored" })).toEqual({
      ok: false,
      at: 0,
    });
  });

  it("rejects anything malformed (missing key, wrong types, non-objects)", () => {
    expect(parseMirrorStatus(null)).toBeNull();
    expect(parseMirrorStatus(undefined)).toBeNull();
    expect(parseMirrorStatus("synced")).toBeNull();
    expect(parseMirrorStatus({ ok: "yes", at: 1 })).toBeNull();
    expect(parseMirrorStatus({ ok: true, at: "now" })).toBeNull();
    expect(parseMirrorStatus({ ok: true })).toBeNull();
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
    await store.publish({ ok: true, at: 5 });
    expect(await store.read()).toEqual({ ok: true, at: 5 });
  });

  it("read() returns null when nothing has been published", async () => {
    const store = createMirrorStatusStore(createMemoryArea());
    expect(await store.read()).toBeNull();
  });

  it("publish() then read() round-trips under STORAGE_KEYS.mirrorStatus, value shape unchanged", async () => {
    const area = createMemoryArea();
    const store = createMirrorStatusStore(area);
    await store.publish({ ok: true, at: 42 });
    expect(area.data[STORAGE_KEYS.mirrorStatus]).toEqual({ ok: true, at: 42 });
    expect(await store.read()).toEqual({ ok: true, at: 42 });
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
    await expect(store.publish({ ok: false, at: 1 })).resolves.toBeUndefined();
  });

  it("read() returns null when storage rejects", async () => {
    const area: StorageLike = {
      get: () => Promise.reject(new Error("boom")),
      set: async () => {},
    };
    const store = createMirrorStatusStore(area);
    expect(await store.read()).toBeNull();
  });
});
