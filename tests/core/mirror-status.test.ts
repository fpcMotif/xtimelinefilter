import { describe, expect, it } from "vitest";

import { mirrorAgeLabel, parseMirrorStatus } from "@/core/mirror-status";

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
