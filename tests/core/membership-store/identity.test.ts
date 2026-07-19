import { describe, expect, it } from "vitest";

import { membershipIdentityOf } from "@/core/membership-store/identity";

describe("membershipIdentityOf", () => {
  it("prefers the stable X user id across handle and post changes", () => {
    expect(membershipIdentityOf({ userId: " 7 ", tweetId: "99" })).toBe("user:7");
    expect(membershipIdentityOf({ userId: "7", tweetId: "100" })).toBe("user:7");
  });

  it("falls back to one observed post when user identity is unknown", () => {
    expect(membershipIdentityOf({ tweetId: " 99 " })).toBe("tweet:99");
  });

  it("never promotes a handle or blank id into cache identity", () => {
    expect(membershipIdentityOf({ userId: " ", tweetId: "" })).toBeNull();
    expect(membershipIdentityOf({})).toBeNull();
  });
});
