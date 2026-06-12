import { describe, expect, it, vi } from "vitest";

import {
  badgeTextFor,
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
    expect(badgeTextFor({ type: "lasso:badge", count: 7 })).toBe("7");
    expect(badgeTextFor({ type: "lasso:badge", count: 0 })).toBe("");
  });

  it("dormant tabs show zz; awake clears it", () => {
    expect(badgeTextFor({ type: "lasso:state", state: "asleep" })).toBe("zz");
    expect(badgeTextFor({ type: "lasso:state", state: "awake" })).toBe("");
  });

  it("ignores unrelated messages", () => {
    expect(badgeTextFor({ type: "something-else" })).toBeNull();
    expect(badgeTextFor(undefined)).toBeNull();
  });
});
