import { describe, expect, it, vi } from "vitest";

import {
  createGraphqlOpsResolver,
  createMemoryOpsCache,
  type GraphqlOpsCache,
} from "@/core/x-client/graphql-ops";
import type { GraphqlOps } from "@/core/x-client/types";

const LIVE: GraphqlOps = {
  ListAddMember: "addLive",
  ListRemoveMember: "rmLive",
  UserByScreenName: "userLive",
};
const FALLBACK: GraphqlOps = {
  ListAddMember: "addStatic",
  ListRemoveMember: "rmStatic",
  UserByScreenName: "userStatic",
};

const HOME = "https://x.com/";
const MAIN_URL = "https://abs.twimg.com/responsive-web/client-web/main.046fa29a.js";
const SHELL_URL =
  "https://abs.twimg.com/responsive-web/client-web/bundle.LoggedOutShell.04ff315a.js";
const LIST_CHUNK_URL =
  "https://abs.twimg.com/responsive-web/client-web/bundle.LoggedInMain.db1efb1a.js";
const HANDLER_CHUNK_URL =
  "https://abs.twimg.com/responsive-web/client-web/loader.ListHandler.6c07507a.js";

/** Verbatim shape of X's operation-table literals (main.046fa29a.js, 2026-07-19). */
const opLiteral = (queryId: string, operationName: string): string =>
  `{queryId:"${queryId}",operationName:"${operationName}",operationType:"mutation",metadata:{featureSwitches:["responsive_web_graphql_timeline_navigation_enabled"],fieldToggles:[]}}`;

const ALL_OPS_BUNDLE = [
  opLiteral(LIVE.ListAddMember, "ListAddMember"),
  opLiteral(LIVE.ListRemoveMember, "ListRemoveMember"),
  opLiteral(LIVE.UserByScreenName, "UserByScreenName"),
].join(",");

/**
 * Verbatim shape of the inline webpack runtime's chunk map in the x.com HTML
 * (2026-07-19), including JS exponent numeric keys (9e3 = 9000).
 */
const chunkMapRuntime = ({ fn = "p", arg = "e" } = {}): string =>
  `${fn}.u=${arg}=>""+(({346:"bundle.NotABot",9e3:"bundle.LoggedInMain",90560:"loader.ListHandler"})[${arg}]||${arg})+"."+({346:"13fff73",9e3:"db1efb1",90560:"6c07507"})[${arg}]+"a.js"`;

const html = (scripts: string[] = [MAIN_URL], runtime: string | null = chunkMapRuntime()): string =>
  `<html><head>${scripts
    .map((s) => `<script defer src="${s}"></script>`)
    .join("")}</head><body>${runtime === null ? "" : `<script>${runtime}</script>`}</body></html>`;

/** URL→body router; unmapped URLs 404 like a bare scrape would, unless a default body is given. */
const router = (map: Record<string, string>, defaultBody?: string) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const body = map[String(input)];
    if (body !== undefined) return new Response(body, { status: 200 });
    return defaultBody === undefined
      ? new Response("not found", { status: 404 })
      : new Response(defaultBody, { status: 200 });
  });

const asFetch = (mock: unknown): typeof fetch => mock as unknown as typeof fetch;

describe("createMemoryOpsCache", () => {
  it("reads null before any write, then round-trips an entry", async () => {
    const cache = createMemoryOpsCache();
    await expect(cache.read()).resolves.toBeNull();
    const entry = { ops: LIVE, fetchedAt: 42 };
    await cache.write(entry);
    await expect(cache.read()).resolves.toEqual(entry);
  });
});

describe("createGraphqlOpsResolver cache behavior", () => {
  it("serves a fresh cache entry without any fetch", async () => {
    const cache = createMemoryOpsCache();
    await cache.write({ ops: LIVE, fetchedAt: 1_000 });
    const fetchMock = router({});
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache,
      fallback: FALLBACK,
      now: () => 1_001,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
    await expect(resolver.resolve()).resolves.toEqual(LIVE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-scrapes a stale entry and persists the fresh result", async () => {
    const cache = createMemoryOpsCache();
    await cache.write({ ops: FALLBACK, fetchedAt: 0 });
    const fetchMock = router({ [HOME]: html(), [MAIN_URL]: ALL_OPS_BUNDLE });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache,
      fallback: FALLBACK,
      now: () => 10_000_000_000, // ~4 months in: well past the 7-day trust window
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
    await expect(cache.read()).resolves.toEqual({ ops: LIVE, fetchedAt: 10_000_000_000 });
  });

  it("honors the injected ttl at its exact boundary", async () => {
    const cache = createMemoryOpsCache();
    await cache.write({ ops: LIVE, fetchedAt: 0 });
    const fetchMock = router({ [HOME]: html(), [MAIN_URL]: ALL_OPS_BUNDLE });
    const deps = {
      fetch: asFetch(fetchMock),
      cache,
      fallback: FALLBACK,
      ttlMs: 100,
      now: () => 99,
    };
    await expect(createGraphqlOpsResolver(deps).resolve()).resolves.toEqual(LIVE);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(createGraphqlOpsResolver({ ...deps, now: () => 100 }).resolve()).resolves.toEqual(
      LIVE,
    );
    expect(fetchMock).toHaveBeenCalled(); // age === ttl counts as stale
  });

  it("memoizes a scrape within the instance", async () => {
    const fetchMock = router({ [HOME]: html(), [MAIN_URL]: ALL_OPS_BUNDLE });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
      now: () => 7,
    });

    await resolver.resolve();
    await resolver.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2); // home + main, once each
  });

  it("treats a throwing cache as empty and swallows a failed write", async () => {
    const brokenCache: GraphqlOpsCache = {
      read: async () => {
        throw new Error("storage down");
      },
      write: async () => {
        throw new Error("quota exceeded");
      },
    };
    const fetchMock = router({ [HOME]: html(), [MAIN_URL]: ALL_OPS_BUNDLE });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: brokenCache,
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("refresh bypasses a fresh cache entry and re-scrapes", async () => {
    const cache = createMemoryOpsCache();
    await cache.write({ ops: FALLBACK, fetchedAt: 1_000 });
    const fetchMock = router({ [HOME]: html(), [MAIN_URL]: ALL_OPS_BUNDLE });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache,
      fallback: FALLBACK,
      now: () => 1_001,
    });

    await expect(resolver.refresh()).resolves.toEqual(LIVE);
    expect(fetchMock).toHaveBeenCalled();
    await expect(cache.read()).resolves.toEqual({ ops: LIVE, fetchedAt: 1_001 });
  });
});

describe("createGraphqlOpsResolver scraping", () => {
  it("resolves every op from the main entry bundle without touching chunks", async () => {
    // Shell listed before main in the HTML; main must be scanned first regardless.
    const fetchMock = router({
      [HOME]: html([SHELL_URL, MAIN_URL]),
      [MAIN_URL]: ALL_OPS_BUNDLE,
      [SHELL_URL]: "no ops here",
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([HOME, MAIN_URL]);
  });

  it("scans later entry bundles when main is incomplete", async () => {
    const fetchMock = router({
      [HOME]: html([MAIN_URL, SHELL_URL]),
      [MAIN_URL]: opLiteral(LIVE.UserByScreenName, "UserByScreenName"),
      [SHELL_URL]: [
        opLiteral(LIVE.ListAddMember, "ListAddMember"),
        opLiteral(LIVE.ListRemoveMember, "ListRemoveMember"),
      ].join(","),
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("follows the chunk map to the lazy chunk carrying the list mutations", async () => {
    const fetchMock = router({
      [HOME]: html(),
      [MAIN_URL]: opLiteral(LIVE.UserByScreenName, "UserByScreenName"),
      [LIST_CHUNK_URL]: [
        opLiteral(LIVE.ListAddMember, "ListAddMember"),
        opLiteral(LIVE.ListRemoveMember, "ListRemoveMember"),
      ].join(","),
      [HANDLER_CHUNK_URL]: "no ops here",
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    // bundle.LoggedInMain ranks ahead of other name-matched candidates.
    expect(urls).toEqual([HOME, MAIN_URL, LIST_CHUNK_URL]);
  });

  it("parses chunk maps whose minified runtime names rotated", async () => {
    const fetchMock = router({
      [HOME]: html([MAIN_URL], chunkMapRuntime({ fn: "n", arg: "x" })),
      [MAIN_URL]: opLiteral(LIVE.UserByScreenName, "UserByScreenName"),
      [LIST_CHUNK_URL]: [
        opLiteral(LIVE.ListAddMember, "ListAddMember"),
        opLiteral(LIVE.ListRemoveMember, "ListRemoveMember"),
      ].join(","),
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("finds a queryId that follows its operationName (rotated key order)", async () => {
    const reversed =
      '{operationName:"ListAddMember",operationType:"mutation",metadata:{},queryId:"addLive"}';
    const fetchMock = router({
      [HOME]: html(),
      [MAIN_URL]: [
        reversed,
        opLiteral(LIVE.ListRemoveMember, "ListRemoveMember"),
        opLiteral(LIVE.UserByScreenName, "UserByScreenName"),
      ].join(","),
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("skips operationName mentions with no queryId in their window", async () => {
    const gap = `/*${"x".repeat(500)}*/`;
    const fetchMock = router({
      [HOME]: html(),
      [MAIN_URL]: `const s = 'operationName:"ListAddMember"';${gap}${ALL_OPS_BUNDLE}`,
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("caps candidate chunk fetches at maxChunkFetches, then falls back", async () => {
    const manyChunks =
      'p.u=e=>""+(({0:"bundle.UserProfile",1:"bundle.LoggedInMain",2:"bundle.LoggedInMainB",3:"bundle.LoggedInMainC",4:"bundle.LoggedInMainD",5:"bundle.LoggedInMainE",6:"bundle.LoggedInMainF",7:"bundle.LoggedInMainG",8:"bundle.LoggedInMainH"})[e]||e)+"."+({1:"h1",2:"h2",3:"h3",4:"h4",5:"h5",6:"h6",7:"h7",8:"h8"})[e]+"a.js"';
    // 0 (bundle.UserProfile) matches the default pattern but has no hash entry → skipped
    // before the cap (numeric chunk ids iterate ascending); the 8 hashed candidates then cap at 6.
    const fetchMock = router(
      { [HOME]: html([MAIN_URL], manyChunks), [MAIN_URL]: "no ops" },
      "no ops",
    );
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
    // home + main + 6 capped chunk fetches (of 8 named candidates).
    expect(fetchMock).toHaveBeenCalledTimes(2 + 6);
  });

  it("honors an injected maxChunkFetches", async () => {
    const fetchMock = router({ [HOME]: html(), [MAIN_URL]: "no ops" });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
      maxChunkFetches: 1,
    });

    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
    // home + main + exactly 1 candidate chunk (both name-matched, best-ranked first).
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(LIST_CHUNK_URL);
  });

  it("honors injected homeUrl and assetBaseUrl", async () => {
    const home = "https://example.test/home";
    const cdn = "https://cdn.test/assets/";
    const fetchMock = router({
      [home]: html(),
      [MAIN_URL]: "no ops", // entry script still points at abs.twimg.com; nothing there
      [`${cdn}bundle.LoggedInMain.db1efb1a.js`]: ALL_OPS_BUNDLE,
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
      homeUrl: home,
      assetBaseUrl: cdn,
    });

    await expect(resolver.resolve()).resolves.toEqual(LIVE);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(home);
  });

  it("falls back when the home page fetch fails", async () => {
    const fetchMock = router({}); // every URL 404s, including the home page
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
    await expect(resolver.refresh()).resolves.toEqual(FALLBACK);
  });

  it("falls back when no bundle carries every op", async () => {
    const fetchMock = router({ [HOME]: "<html>no scripts, no runtime</html>" });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
  });

  it("falls back when a candidate chunk 404s mid-scrape", async () => {
    const fetchMock = router({
      [HOME]: html(),
      [MAIN_URL]: "no ops",
      // LIST_CHUNK_URL unmapped → 404 → scrape aborts → fallback
    });
    const resolver = createGraphqlOpsResolver({
      fetch: asFetch(fetchMock),
      cache: createMemoryOpsCache(),
      fallback: FALLBACK,
    });

    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
  });
});
