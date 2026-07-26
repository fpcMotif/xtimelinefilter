import { describe, expect, it } from "vitest";

import { XApiError } from "@/packages/x-client/types";
import {
  authHeaders,
  ensureOk,
  GRAPHQL_PROFILE,
  rateLimitResetOf,
  REST_PROFILE,
} from "@/packages/x-client/x-http";

/**
 * Direct tests for the X HTTP boundary. Every other x-client module has its own
 * test home; this one pins the transport seam itself — the two ErrorProfile
 * tables and ensureOk's classification mechanics — so a profile edit is caught
 * here by name instead of transitively through rest-api/graphql-api assertions.
 */

const errRes = (errors: Array<{ code?: number; message?: string }>, status = 200) =>
  new Response(JSON.stringify({ errors }), { status });

async function kindOf(res: Response, profile = REST_PROFILE): Promise<XApiError> {
  try {
    await ensureOk(res, profile);
  } catch (e) {
    return e as XApiError;
  }
  throw new Error("expected ensureOk to throw");
}

describe("authHeaders", () => {
  it("carries the session bearer + csrf and the web-session markers", () => {
    expect(authHeaders({ csrf: "c0", bearer: "B" })).toEqual({
      authorization: "Bearer B",
      "x-csrf-token": "c0",
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
    });
  });
});

const resetOf = (v?: string) =>
  rateLimitResetOf(
    new Response("{}", {
      status: 429,
      headers: v === undefined ? {} : { "x-rate-limit-reset": v },
    }),
  );

describe("rateLimitResetOf", () => {
  it("reads epoch seconds from the reset header; absent/garbage/non-positive → undefined", () => {
    expect(resetOf("1782995040")).toBe(1782995040);
    expect(resetOf()).toBeUndefined();
    expect(resetOf("soon")).toBeUndefined();
    expect(resetOf("0")).toBeUndefined();
  });
});

describe("ensureOk — status pre-checks (profile-independent)", () => {
  it("429 → rate-limited, resetAt attached when the header is present", async () => {
    const res = new Response("{}", {
      status: 429,
      headers: { "x-rate-limit-reset": "1782995040" },
    });
    const err = await kindOf(res, GRAPHQL_PROFILE);
    expect(err.kind).toBe("rate-limited");
    expect(err.resetAt).toBe(1782995040);
  });

  it("401 and 403 → auth", async () => {
    expect((await kindOf(new Response("{}", { status: 401 }))).kind).toBe("auth");
    expect((await kindOf(new Response("{}", { status: 403 }))).kind).toBe("auth");
  });
});

describe("ensureOk — errors[] classification through a profile", () => {
  it("REST: already-member matches both message shapes X uses", async () => {
    expect((await kindOf(errRes([{ message: "Already a member." }]))).kind).toBe("already-member");
    expect((await kindOf(errRes([{ message: "Already added to List." }]))).kind).toBe(
      "already-member",
    );
  });

  it("REST: protected matches by code 104 or by message alone", async () => {
    expect((await kindOf(errRes([{ code: 104, message: "nope" }]))).kind).toBe("protected");
    expect(
      (await kindOf(errRes([{ message: "You aren't allowed to add this member." }]))).kind,
    ).toBe("protected");
  });

  it("REST: code 88 → rate-limited with resetAt; codes 32/89 → auth", async () => {
    const rl = new Response(JSON.stringify({ errors: [{ code: 88, message: "slow down" }] }), {
      status: 200,
      headers: { "x-rate-limit-reset": "1782995040" },
    });
    const rlErr = await kindOf(rl);
    expect(rlErr.kind).toBe("rate-limited");
    expect(rlErr.resetAt).toBe(1782995040);
    expect((await kindOf(errRes([{ code: 32 }]))).kind).toBe("auth");
    expect((await kindOf(errRes([{ code: 89 }]))).kind).toBe("auth");
  });

  it("GraphQL: code 353 → auth (a code REST does not treat as auth)", async () => {
    expect((await kindOf(errRes([{ code: 353 }]), GRAPHQL_PROFILE)).kind).toBe("auth");
    expect((await kindOf(errRes([{ code: 353 }]), REST_PROFILE)).kind).toBe("unknown");
  });

  it("GraphQL: protected matches by code alone (its rule carries no message pattern)", async () => {
    expect((await kindOf(errRes([{ code: 104, message: "nope" }]), GRAPHQL_PROFILE)).kind).toBe(
      "protected",
    );
  });

  it("unmatched codes with a real message → unknown carrying that message", async () => {
    const err = await kindOf(errRes([{ code: 1, message: "weird new failure" }]));
    expect(err.kind).toBe("unknown");
    expect(err.message).toBe("weird new failure");
  });

  it("an unrecognised envelope falls back to each profile's named unknown", async () => {
    expect((await kindOf(errRes([{}]), REST_PROFILE)).message).toBe("v1.1 error");
    expect((await kindOf(errRes([{}]), GRAPHQL_PROFILE)).message).toBe("Unknown GraphQL error");
  });

  it("joins multi-error messages with each profile's separator", async () => {
    const two = [
      { code: 104, message: "a" },
      { code: 104, message: "b" },
    ];
    expect((await kindOf(errRes(two), REST_PROFILE)).message).toBe("a; b");
    expect((await kindOf(errRes(two), GRAPHQL_PROFILE)).message).toBe("a ; b");
  });

  it("DIVERGENCE: on a payload carrying both 88 and 104, REST says protected, GraphQL says rate-limited", async () => {
    // The rule ORDER is intentionally different per endpoint (see x-http.ts):
    // REST checks protected(104) before rate-limited(88); GraphQL the reverse.
    // No single backend test combines the two codes, so a flip would otherwise
    // shift silently — this test states the asymmetry as the assertion.
    const both = [{ code: 88 }, { code: 104 }];
    expect((await kindOf(errRes(both), REST_PROFILE)).kind).toBe("protected");
    expect((await kindOf(errRes(both), GRAPHQL_PROFILE)).kind).toBe("rate-limited");
  });
});

describe("ensureOk — success and non-envelope failures", () => {
  it("returns the parsed JSON on success", async () => {
    await expect(
      ensureOk(new Response(JSON.stringify({ ok: 1 }), { status: 200 }), REST_PROFILE),
    ).resolves.toEqual({ ok: 1 });
  });

  it("accepts an explicit empty errors array", async () => {
    await expect(
      ensureOk(new Response(JSON.stringify({ ok: 1, errors: [] }), { status: 200 }), REST_PROFILE),
    ).resolves.toEqual({ ok: 1, errors: [] });
  });

  it.each([{ message: "rejected" }, null, "rejected"])(
    "rejects malformed errors envelopes",
    async (errors) => {
      const err = await kindOf(new Response(JSON.stringify({ ok: 1, errors }), { status: 200 }));
      expect(err.kind).toBe("unknown");
    },
  );

  it("an ok response with an unparseable body resolves to undefined (not a throw)", async () => {
    await expect(
      ensureOk(new Response("not json", { status: 200 }), REST_PROFILE),
    ).resolves.toBeUndefined();
  });

  it("a non-ok response without an errors[] envelope → unknown with the bare status", async () => {
    const err = await kindOf(new Response("not json", { status: 500 }));
    expect(err.kind).toBe("unknown");
    expect(err.message).toBe("HTTP 500");
  });
});
