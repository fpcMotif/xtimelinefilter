import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentAccount } from "@/content/get-current-account";
import { Selectors } from "@/content/selectors";

// Fixtures use the shapes VERIFIED live on x.com 2026-06-13:
//   document.cookie holds `twid=u%3D<19-digit id>` (NOT HttpOnly, readable here);
//   a[data-testid="AppTabBar_Profile_Link"] href is `/<handle>`.
const TWID = "twid=u%3D1700000000000000001";

describe("getCurrentAccount", () => {
  it("reads the logged-in Owner from the twid cookie + profile link", () => {
    const owner = getCurrentAccount({
      cookie: `guest_id=v1%3A17; ${TWID}; ct0=abc123; lang=en`,
      profileHref: () => "/jane_doe",
    });
    expect(owner).toEqual({ userId: "1700000000000000001", screenName: "jane_doe" });
  });

  it("parses twid when it is the first cookie", () => {
    expect(getCurrentAccount({ cookie: `${TWID}; ct0=abc`, profileHref: () => "/me" })).toEqual({
      userId: "1700000000000000001",
      screenName: "me",
    });
  });

  it("returns null when logged out (no twid)", () => {
    expect(
      getCurrentAccount({ cookie: "guest_id=v1%3A17; ct0=abc", profileHref: () => "/x" }),
    ).toBeNull();
  });

  it("returns null when twid carries no numeric id", () => {
    expect(
      getCurrentAccount({ cookie: "twid=garbage; ct0=abc", profileHref: () => "/x" }),
    ).toBeNull();
  });

  it("falls back to empty screenName when the profile link is absent (best-effort)", () => {
    expect(getCurrentAccount({ cookie: TWID, profileHref: () => null })).toEqual({
      userId: "1700000000000000001",
      screenName: "",
    });
  });

  it("takes only the first path segment of the profile href", () => {
    expect(
      getCurrentAccount({ cookie: TWID, profileHref: () => "/jane/status/1?ref=x" })?.screenName,
    ).toBe("jane");
  });

  describe("default profileHref (reads the live DOM)", () => {
    afterEach(() => {
      document.body.replaceChildren();
    });

    it("reads the handle from the profile-link href when profileHref is omitted", () => {
      const link = document.createElement("a");
      link.setAttribute("data-testid", "AppTabBar_Profile_Link");
      link.setAttribute("href", "/live_handle");
      document.body.appendChild(link);

      // `cookie` still supplied so we exercise readProfileHref, not document.cookie.
      expect(getCurrentAccount({ cookie: TWID })).toEqual({
        userId: "1700000000000000001",
        screenName: "live_handle",
      });
      expect(Selectors.CURRENT_USER_PROFILE_LINK).toContain("AppTabBar_Profile_Link");
    });

    it("yields an empty screenName when the profile link is missing from the DOM", () => {
      expect(getCurrentAccount({ cookie: TWID })).toEqual({
        userId: "1700000000000000001",
        screenName: "",
      });
    });

    it("defaults to document.cookie when no cookie dep is given", () => {
      document.cookie = TWID;
      const link = document.createElement("a");
      link.setAttribute("data-testid", "AppTabBar_Profile_Link");
      link.setAttribute("href", "/cookie_owner");
      document.body.appendChild(link);

      expect(getCurrentAccount()).toEqual({
        userId: "1700000000000000001",
        screenName: "cookie_owner",
      });
    });

    it("yields an empty screenName when there is no document at all (SSR/worker guard)", () => {
      vi.stubGlobal("document", undefined);
      try {
        // cookie supplied explicitly so we reach readProfileHref's no-document guard.
        expect(getCurrentAccount({ cookie: TWID })).toEqual({
          userId: "1700000000000000001",
          screenName: "",
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("returns null with no document and no cookie dep (default cookie is the empty string)", () => {
      vi.stubGlobal("document", undefined);
      try {
        // No cookie dep + no document → cookie defaults to "" → no twid → null.
        expect(getCurrentAccount()).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
