import { describe, expect, it } from "vitest";

import { getCurrentAccount } from "@/content/get-current-account";

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
    expect(getCurrentAccount({ cookie: "guest_id=v1%3A17; ct0=abc", profileHref: () => "/x" })).toBeNull();
  });

  it("returns null when twid carries no numeric id", () => {
    expect(getCurrentAccount({ cookie: "twid=garbage; ct0=abc", profileHref: () => "/x" })).toBeNull();
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
});
