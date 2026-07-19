import { describe, expect, it, vi } from "vitest";

import {
  badgePresentationFor,
  handleInstalled,
  UNINSTALL_FORM_URL,
  WELCOME_URL,
} from "@/background/lifecycle";

describe("install moment (story beat 2)", () => {
  it("opens x.com with the welcome hash on first install and sets the uninstall URL", () => {
    const api = { createTab: vi.fn(), setUninstallURL: vi.fn() };
    handleInstalled({ reason: "install" }, api);
    expect(api.createTab).toHaveBeenCalledWith(WELCOME_URL);
    expect(api.setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);
    expect(WELCOME_URL).toBe("https://x.com/home#lasso-welcome");
  });

  it("updates re-set the uninstall URL but never re-open the welcome tab", () => {
    const api = { createTab: vi.fn(), setUninstallURL: vi.fn() };
    handleInstalled({ reason: "update" }, api);
    expect(api.createTab).not.toHaveBeenCalled();
    expect(api.setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);
  });
});

describe("toolbar badge mirrors the live state (story beats 7 & 9)", () => {
  it("shows the live selection count and clears at zero", () => {
    expect(badgePresentationFor({ type: "lasso:badge", count: 7 })).toEqual({
      text: "7",
      backgroundColor: "#1d9bf0",
    });
    expect(badgePresentationFor({ type: "lasso:badge", count: 0 })).toEqual({ text: "" });
  });

  it("dormant tabs show a neutral zz; awake clears it", () => {
    expect(badgePresentationFor({ type: "lasso:state", state: "asleep" })).toEqual({
      text: "zz",
      backgroundColor: "#536471",
    });
    expect(badgePresentationFor({ type: "lasso:state", state: "awake" })).toEqual({ text: "" });
  });

  it("ignores unrelated messages", () => {
    expect(badgePresentationFor(undefined)).toBeNull();
  });
});
