import { describe, expect, it, vi } from "vitest";

import type { GraphqlOperationCatalog } from "@/packages/x-client/graphql-contract";
import {
  createGraphqlCatalogResolver,
  createMemoryCatalogCache,
  type GraphqlCatalogCache,
  type GraphqlCatalogCacheEntry,
} from "@/packages/x-client/graphql-ops";

const FALLBACK: GraphqlOperationCatalog = {
  ListAddMember: {
    queryId: "addStatic",
    features: { add: true, shared: false },
    fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
  },
  ListRemoveMember: {
    queryId: "rmStatic",
    features: { remove: true, shared: false },
    fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
  },
  UserByScreenName: {
    queryId: "userStatic",
    features: { user: true, shared: false },
    fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
  },
};
const LIVE: GraphqlOperationCatalog = {
  ListAddMember: { ...FALLBACK.ListAddMember, queryId: "addLive" },
  ListRemoveMember: { ...FALLBACK.ListRemoveMember, queryId: "rmLive" },
  UserByScreenName: { ...FALLBACK.UserByScreenName, queryId: "userLive" },
};
const HOME = "https://x.com/";
const MAIN = "https://abs.twimg.com/responsive-web/client-web/main.046fa29a.js";
const CHUNK = "https://abs.twimg.com/responsive-web/client-web/bundle.LoggedInMain.abca.js";
const TOGGLES = ["withAuxiliaryUserLabels", "withPayments"];
const typeFor = (operationName: string) =>
  operationName === "UserByScreenName" ? "query" : "mutation";
const literal = (
  queryId: string,
  operationName: string,
  features: string[],
  fieldToggles: string[] | null = TOGGLES,
) =>
  `m.exports={metadata:{${fieldToggles ? `fieldToggles:${JSON.stringify(fieldToggles)},` : ""}featureSwitches:${JSON.stringify(features)}},operationName:"${operationName}",operationType:"${typeFor(operationName)}",queryId:"${queryId}"}`;
const bundle = [
  literal("addLive", "ListAddMember", ["add", "shared"]),
  literal("rmLive", "ListRemoveMember", ["remove", "shared"]),
  literal(
    "userLive",
    "UserByScreenName",
    ["user", "shared"],
    ["withPayments", "withAuxiliaryUserLabels"],
  ),
].join(",");
const html = `<script src="${MAIN}"></script>`;
const htmlWithChunk = `${html}<script>.u=e=>""+(({1:"bundle.LoggedInMain"})[e]||e)+"."+({1:"abc"})[e]+"a.js"</script>`;
const fetcher = (map: Record<string, string>) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const body = map[String(input)];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  });
const asFetch = (value: unknown): typeof fetch => value as typeof fetch;
const seed = async (cache: GraphqlCatalogCache, entry: GraphqlCatalogCacheEntry): Promise<void> => {
  await cache.write(entry, await cache.begin());
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("GraphqlCatalogResolver", () => {
  it("uses a fresh complete catalog cache without fetching", async () => {
    const cache = createMemoryCatalogCache();
    await seed(cache, { catalog: LIVE, fetchedAt: 10 });
    const fetch = fetcher({});
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache,
        fallback: FALLBACK,
        now: () => 11,
      }).resolve(),
    ).resolves.toEqual(LIVE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps current fallback booleans when a compatible cached ID survives an update", async () => {
    const cache = createMemoryCatalogCache();
    await seed(cache, {
      catalog: {
        ...LIVE,
        ListAddMember: {
          queryId: "old-id",
          features: { add: false, shared: true },
          fieldToggles: { withAuxiliaryUserLabels: true, withPayments: true },
        },
      },
      fetchedAt: 10,
    });
    const fetch = fetcher({});
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache,
        fallback: FALLBACK,
        now: () => 11,
      }).resolve(),
    ).resolves.toEqual({
      ...LIVE,
      ListAddMember: { ...FALLBACK.ListAddMember, queryId: "old-id" },
      ListRemoveMember: { ...FALLBACK.ListRemoveMember, queryId: "rmLive" },
      UserByScreenName: { ...FALLBACK.UserByScreenName, queryId: "userLive" },
    });
  });

  it("memoizes fallback after an unsuccessful scrape", async () => {
    const fetch = fetcher({ [HOME]: "<html/>" });
    const resolver = createGraphqlCatalogResolver({
      fetch: asFetch(fetch),
      cache: createMemoryCatalogCache(),
      fallback: FALLBACK,
    });
    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
    await expect(resolver.resolve()).resolves.toEqual(FALLBACK);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("replaces IDs only; fallback booleans remain authoritative", async () => {
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    const resolver = createGraphqlCatalogResolver({
      fetch: asFetch(fetch),
      cache: createMemoryCatalogCache(),
      fallback: FALLBACK,
    });
    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("parses live-shaped webpack module exports", async () => {
    const quoted = [
      `m.exports={"queryId":"addLive","metadata":{"featureSwitches":["add","shared"],"fieldToggles":${JSON.stringify(TOGGLES)}},"operationName":"ListAddMember","operationType":"mutation"}`,
      literal("rmLive", "ListRemoveMember", ["remove", "shared"]),
      literal(
        "userLive",
        "UserByScreenName",
        ["user", "shared"],
        ["withAuxiliaryUserLabels", "withPayments"],
      ),
    ].join(",");
    const fetch = fetcher({ [HOME]: html, [MAIN]: quoted });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("ignores a compatible object that is not an export assignment", async () => {
    const decoy = bundle.replaceAll("m.exports=", "const decoy=");
    const fetch = fetcher({ [HOME]: html, [MAIN]: `${decoy};${bundle}` });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("skips control-statement regex literals, flags, escapes, and classes", async () => {
    const regexes = [
      `if (x) {} else /${literal("evilAdd", "ListAddMember", ["add", "shared"])}/g.test(x)`,
      `if (x) /escaped\\/${literal("evilRm", "ListRemoveMember", ["remove", "shared"])}/.test(x)`,
      `if (x) {} /[\\/]${literal("evilUser", "UserByScreenName", ["user", "shared"])}/.test(x)`,
    ].join(";");
    const fetch = fetcher({ [HOME]: html, [MAIN]: `${regexes};${bundle}` });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("falls back when an export descriptor conflicts with another fetched descriptor", async () => {
    const conflict = literal("different", "ListAddMember", ["add", "shared"]);
    const fetch = fetcher({ [HOME]: htmlWithChunk, [MAIN]: bundle, [CHUNK]: conflict });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
  });

  it("accepts identical export descriptors across fetched texts", async () => {
    const duplicate = literal("addLive", "ListAddMember", ["add", "shared"]);
    const fetch = fetcher({ [HOME]: htmlWithChunk, [MAIN]: bundle, [CHUNK]: duplicate });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it.each([
    ["a missing feature", bundle.replace('"add","shared"', '"add"')],
    [
      "an extra toggle",
      bundle.replace(
        '"withAuxiliaryUserLabels","withPayments"',
        '"withAuxiliaryUserLabels","extra"',
      ),
    ],
    ["a wrong operation type", bundle.replace('operationType:"mutation"', 'operationType:"query"')],
    ["a partial export", bundle.slice(0, -1)],
  ])("uses the full fallback for %s", async (_name, text) => {
    const fetch = fetcher({ [HOME]: html, [MAIN]: text });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
  });

  it("falls back and does not cache IDs from a bundle with an unterminated block comment", async () => {
    const cache = createMemoryCatalogCache();
    const fetch = fetcher({ [HOME]: html, [MAIN]: `${bundle}/*` });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache,
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
    await expect(cache.read()).resolves.toBeNull();
  });

  it.each(["", "a/../UserByScreenName", "has space", "x".repeat(129)])(
    "uses the fallback for malformed query ID %j",
    async (queryId) => {
      const text = bundle.replace('queryId:"addLive"', `queryId:"${queryId}"`);
      const fetch = fetcher({ [HOME]: html, [MAIN]: text });
      await expect(
        createGraphqlCatalogResolver({
          fetch: asFetch(fetch),
          cache: createMemoryCatalogCache(),
          fallback: FALLBACK,
        }).resolve(),
      ).resolves.toEqual(FALLBACK);
    },
  );

  it("accepts missing field toggles when the fallback has none", async () => {
    const fallback = {
      ...FALLBACK,
      ListAddMember: { queryId: "addStatic", features: { add: true, shared: false } },
    } satisfies GraphqlOperationCatalog;
    const live = [
      literal("addLive", "ListAddMember", ["add", "shared"], null),
      literal("rmLive", "ListRemoveMember", ["remove", "shared"]),
      literal("userLive", "UserByScreenName", ["user", "shared"]),
    ].join(",");
    const fetch = fetcher({ [HOME]: html, [MAIN]: live });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback,
      }).resolve(),
    ).resolves.toEqual({
      ...fallback,
      ListAddMember: { ...fallback.ListAddMember, queryId: "addLive" },
      ListRemoveMember: { ...fallback.ListRemoveMember, queryId: "rmLive" },
      UserByScreenName: { ...fallback.UserByScreenName, queryId: "userLive" },
    });
  });

  it("does not treat future cache entries as fresh", async () => {
    const cache = createMemoryCatalogCache();
    await seed(cache, { catalog: LIVE, fetchedAt: 100 });
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache,
        fallback: FALLBACK,
        now: () => 10,
      }).resolve(),
    ).resolves.toEqual(LIVE);
    expect(fetch).toHaveBeenCalled();
  });

  it("bounds entry bundle fetches", async () => {
    const entries = Array.from(
      { length: 10 },
      (_, index) =>
        `https://abs.twimg.com/responsive-web/client-web/main.${index.toString(16).padStart(8, "0")}.js`,
    );
    const manyEntries = entries.map((url) => `<script src="${url}"></script>`).join("");
    const fetch = fetcher({
      [HOME]: manyEntries,
      ...Object.fromEntries(entries.map((url, index) => [url, index === 0 ? bundle : ""])),
    });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
        maxEntryBundleFetches: 2,
      }).resolve(),
    ).resolves.toEqual(LIVE);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("persists a full catalog and refresh bypasses a fresh cache", async () => {
    const cache = createMemoryCatalogCache();
    await seed(cache, { catalog: FALLBACK, fetchedAt: 10 });
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    const resolver = createGraphqlCatalogResolver({
      fetch: asFetch(fetch),
      cache,
      fallback: FALLBACK,
      now: () => 11,
    });
    await expect(resolver.refresh()).resolves.toEqual(LIVE);
    await expect(cache.read()).resolves.toEqual({ catalog: LIVE, fetchedAt: 11 });
  });

  it("fences stale writes in the memory adapter without rejecting an older sole success", async () => {
    const cache = createMemoryCatalogCache();
    const older = await cache.begin();
    const newer = await cache.begin();

    await expect(cache.write({ catalog: LIVE, fetchedAt: 2 }, newer)).resolves.toEqual({
      catalog: LIVE,
      fetchedAt: 2,
    });
    await expect(cache.write({ catalog: FALLBACK, fetchedAt: 1 }, older)).resolves.toEqual({
      catalog: LIVE,
      fetchedAt: 2,
    });

    const failedNewer = createMemoryCatalogCache();
    const soleSuccess = await failedNewer.begin();
    await failedNewer.begin();
    await expect(failedNewer.write({ catalog: LIVE, fetchedAt: 3 }, soleSuccess)).resolves.toEqual({
      catalog: LIVE,
      fetchedAt: 3,
    });
  });

  it("does not return a fenced memory entry", async () => {
    const cache = createMemoryCatalogCache();
    const token = await cache.begin();
    await cache.write({ catalog: LIVE, fetchedAt: 1 }, token);

    await expect(cache.read()).resolves.toEqual({ catalog: LIVE, fetchedAt: 1 });
  });

  it("adopts the newer cache winner when an older scrape finishes last", async () => {
    const oldUrl = "https://abs.twimg.com/responsive-web/client-web/main.aaaaaaaa.js";
    const newUrl = "https://abs.twimg.com/responsive-web/client-web/main.bbbbbbbb.js";
    const oldBody = deferred<string>();
    let homes = 0;
    const catalog = (suffix: string): GraphqlOperationCatalog => ({
      ListAddMember: { ...FALLBACK.ListAddMember, queryId: `add${suffix}` },
      ListRemoveMember: { ...FALLBACK.ListRemoveMember, queryId: `remove${suffix}` },
      UserByScreenName: { ...FALLBACK.UserByScreenName, queryId: `user${suffix}` },
    });
    const body = (suffix: string): string =>
      [
        literal(`add${suffix}`, "ListAddMember", ["add", "shared"]),
        literal(`remove${suffix}`, "ListRemoveMember", ["remove", "shared"]),
        literal(
          `user${suffix}`,
          "UserByScreenName",
          ["user", "shared"],
          ["withPayments", "withAuxiliaryUserLabels"],
        ),
      ].join(",");
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === HOME) {
        const source = homes++ === 0 ? oldUrl : newUrl;
        return new Response(`<script src="${source}"></script>`);
      }
      if (url === oldUrl) return new Response(await oldBody.promise);
      if (url === newUrl) return new Response(body("New"));
      return new Response("missing", { status: 404 });
    });
    const resolver = createGraphqlCatalogResolver({
      fetch: asFetch(fetch),
      cache: createMemoryCatalogCache(),
      fallback: FALLBACK,
    });

    const oldRefresh = resolver.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(oldUrl, { credentials: "include" }));
    const newRefresh = resolver.refresh();
    await expect(newRefresh).resolves.toEqual(catalog("New"));
    oldBody.resolve(body("Old"));

    await expect(oldRefresh).resolves.toEqual(catalog("New"));
    await expect(resolver.resolve()).resolves.toEqual(catalog("New"));
  });

  it("does not let a failed concurrent scrape replace a successful memo", async () => {
    const oldUrl = "https://abs.twimg.com/responsive-web/client-web/main.cccccccc.js";
    const oldBody = deferred<string>();
    let homes = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === HOME) {
        homes += 1;
        return new Response(homes === 1 ? `<script src="${oldUrl}"></script>` : "<html/>");
      }
      if (url === oldUrl) return new Response(await oldBody.promise);
      return new Response("missing", { status: 404 });
    });
    const resolver = createGraphqlCatalogResolver({
      fetch: asFetch(fetch),
      cache: createMemoryCatalogCache(),
      fallback: FALLBACK,
    });

    const successful = resolver.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(oldUrl, { credentials: "include" }));
    await expect(resolver.refresh()).resolves.toEqual(FALLBACK);
    oldBody.resolve(bundle);

    await expect(successful).resolves.toEqual(LIVE);
    await expect(resolver.resolve()).resolves.toEqual(LIVE);
  });

  it("treats cache failures as empty and write failures as nonfatal", async () => {
    const cache: GraphqlCatalogCache = {
      read: async () => {
        throw new Error("down");
      },
      begin: async () => {
        throw new Error("down");
      },
      write: async () => {
        throw new Error("full");
      },
    };
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    await expect(
      createGraphqlCatalogResolver({ fetch: asFetch(fetch), cache, fallback: FALLBACK }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("fails closed on malformed parser grammar without evaluating bundle text", async () => {
    const malformed = [
      `m.exports={1:"bad"}`,
      `m.exports={metadata:{featureSwitches:[true,false,null]},operationName:"ListAddMember",operationType:"mutation",queryId:"addLive"}`,
      `return /unterminated\n`,
      `m.exports={metadata:{featureSwitches:["add","shared"],fieldToggles:["withAuxiliaryUserLabels","withPayments"]},operationName:"Unknown",operationType:"mutation",queryId:"ignored"}`,
    ].join(";");
    const fetch = fetcher({ [HOME]: html, [MAIN]: `${malformed};${bundle}` });

    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
  });

  it("rejects conflicting descriptors found inside one bundle", async () => {
    const conflict = literal("different", "ListAddMember", ["add", "shared"]);
    const fetch = fetcher({ [HOME]: html, [MAIN]: `${bundle};${conflict}` });

    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
  });

  it("treats bad cache entries and failed catalog transport as untrusted", async () => {
    for (const catalog of [
      { ...LIVE, ListAddMember: { ...LIVE.ListAddMember, queryId: "bad/id" } },
      { ...LIVE, ListAddMember: { ...LIVE.ListAddMember, features: { different: true } } },
      {
        ...LIVE,
        ListAddMember: { ...LIVE.ListAddMember, fieldToggles: { different: false } },
      },
    ] satisfies GraphqlOperationCatalog[]) {
      const cache = createMemoryCatalogCache();
      await seed(cache, { catalog, fetchedAt: 1 });
      const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
      await expect(
        createGraphqlCatalogResolver({
          fetch: asFetch(fetch),
          cache,
          fallback: FALLBACK,
          now: () => 2,
        }).resolve(),
      ).resolves.toEqual(LIVE);
      expect(fetch).toHaveBeenCalled();
    }

    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetcher({})),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
  });

  it("bounds and orders candidate chunks, skipping entries without hashes", async () => {
    const chunks = `${html}<script>.u=e=>""+(({1:"UserLists",2:"bundle.LoggedInMain",3:"Other"})[e]||e)+"."+({2:"two",3:"three"})[e]+"a.js"</script>`;
    const loggedIn = "https://abs.twimg.com/responsive-web/client-web/bundle.LoggedInMain.twoa.js";
    const fetch = fetcher({ [HOME]: chunks, [MAIN]: bundle, [loggedIn]: bundle });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
        maxChunkFetches: 1,
      }).resolve(),
    ).resolves.toEqual(LIVE);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([HOME, MAIN, loggedIn]);
  });

  it("survives a write failure after a successful scrape", async () => {
    const cache: GraphqlCatalogCache = {
      read: async () => null,
      begin: async () => ({ epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }),
      write: async () => {
        throw new Error("full");
      },
    };
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    await expect(
      createGraphqlCatalogResolver({ fetch: asFetch(fetch), cache, fallback: FALLBACK }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("parses only the narrow metadata grammar across hostile JavaScript syntax", async () => {
    const prefixes = [
      `m.exports={x:["a",'b',\`c\`,true,false,null]};`,
      `m.exports={};`,
      `m.exports={x:"y" z};`,
      `m.exports={x:};`,
      `m.exports={x:[ ]};`,
      `m.exports={x:["y" z]};`,
      `m.exports={x:["y",]};`,
      `m.exports={x:"unterminated\\`,
      `// a complete comment\n/* a complete block */ foo()  ;`,
      `m.exports={metadata:{featureSwitches:["add","shared"],fieldToggles:["withAuxiliaryUserLabels","withPayments"]},operationName:"Unknown",operationType:"mutation",queryId:"ignored"};`,
    ];
    for (const prefix of prefixes) {
      const fetch = fetcher({ [HOME]: html, [MAIN]: `${prefix}${bundle}` });
      await expect(
        createGraphqlCatalogResolver({
          fetch: asFetch(fetch),
          cache: createMemoryCatalogCache(),
          fallback: FALLBACK,
        }).resolve(),
      ).resolves.toEqual(prefix.includes("unterminated") ? FALLBACK : LIVE);
    }
  });

  it("rejects unterminated line comments and strings", async () => {
    for (const text of [
      "// unfinished",
      `m.exports={x:'unfinished`,
      'm.exports={x:"\\',
      "return /unterminated",
      "m.exports={x:",
      "m.exports={    ",
      "m.exports={x ",
      "m.exports={x:[",
      'm.exports={x:["y"',
    ]) {
      const fetch = fetcher({ [HOME]: html, [MAIN]: text });
      await expect(
        createGraphqlCatalogResolver({
          fetch: asFetch(fetch),
          cache: createMemoryCatalogCache(),
          fallback: FALLBACK,
        }).resolve(),
      ).resolves.toEqual(FALLBACK);
    }
  });

  it("treats unusable cache write tokens as no-op observations", async () => {
    const cache = createMemoryCatalogCache();
    await expect(
      cache.write(
        { catalog: LIVE, fetchedAt: 1 },
        { epoch: "00000000-0000-4000-8000-000000000002", sequence: 1 },
      ),
    ).resolves.toBeUndefined();
  });

  it("fails closed on non-record operation metadata", async () => {
    const invalid = `m.exports={metadata:null,operationName:"ListAddMember",operationType:"mutation",queryId:"addLive"}`;
    const fetch = fetcher({ [HOME]: html, [MAIN]: `${invalid};${bundle}` });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(FALLBACK);
  });

  it("uses a scraped catalog when storage declines a write", async () => {
    const cache: GraphqlCatalogCache = {
      read: async () => null,
      begin: async () => ({ epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }),
      write: async () => undefined,
    };
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    await expect(
      createGraphqlCatalogResolver({ fetch: asFetch(fetch), cache, fallback: FALLBACK }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("uses parser boundary states without treating them as executable JavaScript", async () => {
    const fetch = fetcher({ [HOME]: html, [MAIN]: `m.exports={x:   "y"};)${bundle}` });
    await expect(
      createGraphqlCatalogResolver({
        fetch: asFetch(fetch),
        cache: createMemoryCatalogCache(),
        fallback: FALLBACK,
      }).resolve(),
    ).resolves.toEqual(LIVE);
  });

  it("keeps a valid scrape when a cache returns an incompatible winner", async () => {
    const cache: GraphqlCatalogCache = {
      read: async () => null,
      begin: async () => ({ epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }),
      write: async () => ({
        catalog: { ...LIVE, ListAddMember: { ...LIVE.ListAddMember, queryId: "bad/id" } },
        fetchedAt: 1,
      }),
    };
    const fetch = fetcher({ [HOME]: html, [MAIN]: bundle });
    await expect(
      createGraphqlCatalogResolver({ fetch: asFetch(fetch), cache, fallback: FALLBACK }).resolve(),
    ).resolves.toEqual(LIVE);
  });
});
