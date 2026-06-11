import { describe, expect, it } from "vitest";

import { detectPlatform, keycaps } from "@/core/keycaps";

describe("keycaps", () => {
  it("renders Alt combos as Alt on Windows/Linux", () => {
    expect(keycaps("Alt+l", "other")).toEqual(["Alt", "L"]);
    expect(keycaps("Alt+Shift+l", "other")).toEqual(["Alt", "Shift", "L"]);
  });

  it("renders Alt as ⌥ and Shift as ⇧ on macOS", () => {
    expect(keycaps("Alt+l", "mac")).toEqual(["⌥", "L"]);
    expect(keycaps("Alt+Shift+l", "mac")).toEqual(["⌥", "⇧", "L"]);
  });

  it("uppercases bare letters and passes other keys through", () => {
    expect(keycaps("s", "other")).toEqual(["S"]);
    expect(keycaps("?", "mac")).toEqual(["?"]);
    expect(keycaps("Escape", "other")).toEqual(["Esc"]);
  });

  it("detects macOS from the platform string", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ platform: "Win32" })).toBe("other");
    expect(detectPlatform({ platform: "", userAgent: "Mozilla (Macintosh)" })).toBe("mac");
    expect(detectPlatform({})).toBe("other");
  });
});
