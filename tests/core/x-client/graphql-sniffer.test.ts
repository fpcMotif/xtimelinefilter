import { describe, expect, it, vi } from "vitest";

import { DEFAULT_GRAPHQL_CONFIG } from "@/core/x-client/graphql-config";
import {
  createGraphqlSniffer,
  parseGraphqlRequest,
  wrapFetchWithSniffer,
} from "@/core/x-client/graphql-sniffer";

describe("parseGraphqlRequest", () => {
  it("extracts opName + queryId + features from a GET (features in query string)", () => {
    const url =
      "https://x.com/i/api/graphql/ABC123/UserByScreenName?variables=%7B%7D&features=%7B%22f%22%3Atrue%7D";
    expect(parseGraphqlRequest(url)).toEqual({
      opName: "UserByScreenName",
      queryId: "ABC123",
      features: { f: true },
    });
  });

  it("extracts features from a POST body when not in the query string", () => {
    const url = "https://x.com/i/api/graphql/XYZ789/ListAddMember";
    const body = JSON.stringify({ variables: { listId: "1" }, features: { g: false } });
    expect(parseGraphqlRequest(url, body)).toEqual({
      opName: "ListAddMember",
      queryId: "XYZ789",
      features: { g: false },
    });
  });

  it("returns null for non-GraphQL urls", () => {
    expect(parseGraphqlRequest("https://x.com/home")).toBeNull();
  });

  it("ignores malformed feature data and non-json bodies", () => {
    expect(parseGraphqlRequest("https://x.com/i/api/graphql/Q/Op?features={bad")).toEqual({
      opName: "Op",
      queryId: "Q",
    });
    expect(parseGraphqlRequest("https://x.com/i/api/graphql/Q/Op", "not json")).toEqual({
      opName: "Op",
      queryId: "Q",
    });
  });
});

describe("createGraphqlSniffer", () => {
  it("updates tracked op queryIds and merges features over the seed", () => {
    const sniffer = createGraphqlSniffer(DEFAULT_GRAPHQL_CONFIG);
    sniffer.record(
      "https://x.com/i/api/graphql/NEWADD/ListAddMember",
      JSON.stringify({ features: { z: true } }),
    );
    const cfg = sniffer.config();
    expect(cfg.ops.ListAddMember).toBe("NEWADD");
    expect(cfg.ops.UserByScreenName).toBe(DEFAULT_GRAPHQL_CONFIG.ops.UserByScreenName);
    expect(cfg.features.z).toBe(true);
  });

  it("ignores GraphQL ops it does not track", () => {
    const sniffer = createGraphqlSniffer(DEFAULT_GRAPHQL_CONFIG);
    sniffer.record("https://x.com/home");
    sniffer.record("https://x.com/i/api/graphql/QID/HomeTimeline");
    expect(sniffer.config().ops).toEqual(DEFAULT_GRAPHQL_CONFIG.ops);
  });
});

describe("wrapFetchWithSniffer", () => {
  it("records each request then delegates to the original fetch", async () => {
    const original = vi.fn(async () => new Response("{}"));
    const sniffer = createGraphqlSniffer(DEFAULT_GRAPHQL_CONFIG);
    const wrapped = wrapFetchWithSniffer(original as unknown as typeof fetch, sniffer);

    await wrapped("https://x.com/i/api/graphql/WRAPPED/ListRemoveMember");

    expect(original).toHaveBeenCalledTimes(1);
    expect(sniffer.config().ops.ListRemoveMember).toBe("WRAPPED");
  });

  it("accepts URL and Request inputs, and ignores non-string bodies", async () => {
    const original = vi.fn(async () => new Response("{}"));
    const sniffer = createGraphqlSniffer(DEFAULT_GRAPHQL_CONFIG);
    const wrapped = wrapFetchWithSniffer(original as unknown as typeof fetch, sniffer);

    await wrapped(new URL("https://x.com/i/api/graphql/URLQ/ListAddMember"));
    await wrapped(new Request("https://x.com/i/api/graphql/REQQ/UserByScreenName"), {
      body: new URLSearchParams({ features: "{}" }),
      method: "POST",
    });
    await wrapped("https://x.com/i/api/graphql/BODYQ/ListRemoveMember", {
      body: JSON.stringify({ features: { bodyFeature: true } }),
      method: "POST",
    });

    expect(sniffer.config().ops.ListAddMember).toBe("URLQ");
    expect(sniffer.config().ops.UserByScreenName).toBe("REQQ");
    expect(sniffer.config().ops.ListRemoveMember).toBe("BODYQ");
    expect(sniffer.config().features.bodyFeature).toBe(true);
  });

  it("never lets sniffing failures break the fetch", async () => {
    const original = vi.fn(async () => new Response("{}"));
    const sniffer = createGraphqlSniffer(DEFAULT_GRAPHQL_CONFIG);
    const wrapped = wrapFetchWithSniffer(original as unknown as typeof fetch, sniffer);
    const badInput = {
      get url() {
        throw new Error("broken getter");
      },
    } as unknown as Request;

    await expect(wrapped(badInput)).resolves.toBeInstanceOf(Response);
    expect(original).toHaveBeenCalledTimes(1);
    const [firstInput] = original.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit?];
    expect(firstInput).toBe(badInput);
  });
});
