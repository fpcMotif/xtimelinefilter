import { describe, expect, it } from "vitest";

import { createDocumentAuth, PUBLIC_WEB_BEARER } from "@/core/x-client/auth";
import { XApiError } from "@/core/x-client/types";

describe("createDocumentAuth", () => {
  it("reads ct0 from the cookie jar as the csrf token", () => {
    const auth = createDocumentAuth({ getCookie: () => "guest_id=1; ct0=abc123; lang=en" });
    expect(auth.credentials().csrf).toBe("abc123");
  });

  it("uses a provided bearer, otherwise the seeded public web bearer", () => {
    expect(createDocumentAuth({ getCookie: () => "ct0=x", bearer: "B" }).credentials().bearer).toBe(
      "B",
    );
    expect(createDocumentAuth({ getCookie: () => "ct0=x" }).credentials().bearer).toBe(
      PUBLIC_WEB_BEARER,
    );
    expect(PUBLIC_WEB_BEARER.length).toBeGreaterThan(20);
  });

  it("url-decodes cookie values", () => {
    expect(createDocumentAuth({ getCookie: () => "ct0=a%20b" }).credentials().csrf).toBe("a b");
  });

  it("throws a typed auth error when ct0 is absent (logged out)", () => {
    const auth = createDocumentAuth({ getCookie: () => "guest_id=1" });
    expect(() => auth.credentials()).toThrow(XApiError);
    try {
      auth.credentials();
    } catch (e) {
      expect((e as XApiError).kind).toBe("auth");
    }
  });
});
