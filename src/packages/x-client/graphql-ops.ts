import type { GraphqlOps } from "./types";

/** Persisted scrape result. */
export interface GraphqlOpsCacheEntry {
  ops: GraphqlOps;
  fetchedAt: number;
}

/** Storage seam for scraped ops (chrome.storage in the extension, memory in tests). */
export interface GraphqlOpsCache {
  read(): Promise<GraphqlOpsCacheEntry | null>;
  write(entry: GraphqlOpsCacheEntry): Promise<void>;
}

/**
 * Self-healing source of GraphQL query ids. X rotates ids with most client deploys,
 * so rather than trusting the static fallback the resolver scrapes the operation
 * tables out of X's own current bundles: the x.com HTML names the entry bundles,
 * and its inline webpack runtime carries the chunk map that locates lazy chunks
 * (ListAddMember currently lives in bundle.LoggedInMain, UserByScreenName in main).
 */
export interface GraphqlOpsResolver {
  /** Cached-fresh ops, else a scrape, else the static fallback. Never throws. */
  resolve(): Promise<GraphqlOps>;
  /** Forces a fresh scrape (after an endpoint 404), else the static fallback. Never throws. */
  refresh(): Promise<GraphqlOps>;
}

export interface GraphqlOpsResolverDeps {
  fetch: typeof fetch;
  cache: GraphqlOpsCache;
  /** Static seed used when scraping fails (see graphql-config.ts). */
  fallback: GraphqlOps;
  now?: () => number;
  /** How long a scraped/cached map is trusted before re-scraping. Default 7 days. */
  ttlMs?: number;
  homeUrl?: string;
  assetBaseUrl?: string;
  /** Lazy-chunk names worth fetching when the entry bundles don't carry every op. */
  candidateChunkPattern?: RegExp;
  maxChunkFetches?: number;
}

const OP_NAMES = ["ListAddMember", "ListRemoveMember", "UserByScreenName"] as const;
type OpName = (typeof OP_NAMES)[number];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ENTRY_SCRIPT = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[^"'\s]+?\.js/g;
const MAIN_BUNDLE = /\/main\.[a-f0-9]+\.js$/;
// The inline webpack runtime's chunk-url builder, verbatim shape:
//   p.u=e=>""+(({346:"bundle.NotABot"})[e]||e)+"."+({346:"13fff73"})[e]+"a.js"
// Minified variable letters rotate per build, so the param is captured + backreferenced.
const CHUNK_MAP =
  /\.u=(\w+)=>""\+\(\(\{([^}]*)\}\)\[\1\]\|\|\1\)\+"\."\+\(\{([^}]*)\}\)\[\1\]\+"a\.js"/;
const MAP_PAIR = /([{,])(\w+):"((?:[^"\\]|\\.)*)"/g;
const QUERY_ID = /queryId:"([^"]+)"/;
const QUERY_ID_G = /queryId:"([^"]+)"/g;
/** Bounded window around an operationName literal that must contain its queryId. */
const OP_WINDOW = 400;

/** In-memory cache — tests, and the factory default outside the extension host. */
export function createMemoryOpsCache(): GraphqlOpsCache {
  let entry: GraphqlOpsCacheEntry | null = null;
  return {
    read: async () => entry,
    write: async (next) => {
      entry = next;
    },
  };
}

export function createGraphqlOpsResolver(deps: GraphqlOpsResolverDeps): GraphqlOpsResolver {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? WEEK_MS;
  const homeUrl = deps.homeUrl ?? "https://x.com/";
  const assetBase = deps.assetBaseUrl ?? "https://abs.twimg.com/responsive-web/client-web/";
  const chunkPattern =
    deps.candidateChunkPattern ?? /LoggedInMain|UserLists|ListHandler|UserProfile/;
  const maxChunks = deps.maxChunkFetches ?? 6;
  let memo: GraphqlOps | null = null;

  const fetchText = async (url: string): Promise<string> => {
    const res = await deps.fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`ops scrape got HTTP ${res.status} for ${url}`);
    return res.text();
  };

  /**
   * Scans bundle text for each wanted op's `{queryId, operationName}` literal. Key
   * order rotates with the minifier, so the queryId is searched on both sides of the
   * operationName marker (nearest preceding wins, else the nearest following).
   */
  const parseOps = (text: string, wanted: readonly OpName[]): Partial<GraphqlOps> => {
    const found: Partial<GraphqlOps> = {};
    for (const op of wanted) {
      const marker = `operationName:"${op}"`;
      for (
        let at = text.indexOf(marker);
        at !== -1 && found[op] === undefined;
        at = text.indexOf(marker, at + marker.length)
      ) {
        const before = text.slice(Math.max(0, at - OP_WINDOW), at);
        for (const m of before.matchAll(QUERY_ID_G)) found[op] = m[1];
        found[op] ??= QUERY_ID.exec(
          text.slice(at + marker.length, at + marker.length + OP_WINDOW),
        )?.[1];
      }
    }
    return found;
  };

  /** Entry scripts named by the HTML, main.*.js first — it carries the shared op table. */
  const entryBundleUrls = (html: string): string[] =>
    [...new Set(html.match(ENTRY_SCRIPT) ?? [])].toSorted(
      (a, b) => Number(!MAIN_BUNDLE.test(a)) - Number(!MAIN_BUNDLE.test(b)),
    );

  /** Lazy-chunk URLs most likely to hold list ops, best-named first, capped. */
  const candidateChunkUrls = (html: string): string[] => {
    const m = CHUNK_MAP.exec(html);
    if (!m) return [];
    // Both capture groups participate whenever the runtime pattern matches.
    const names = parseChunkMap(m[2] as string);
    const hashes = parseChunkMap(m[3] as string);
    const urls: string[] = [];
    const candidates = Object.entries(names)
      .filter(([, name]) => chunkPattern.test(name))
      // The observed home of the list mutations ranks first; the rest is name-guess order.
      .toSorted(
        (a, b) => Number(a[1] !== "bundle.LoggedInMain") - Number(b[1] !== "bundle.LoggedInMain"),
      );
    for (const [id, name] of candidates) {
      const hash = hashes[id];
      if (!hash) continue;
      urls.push(`${assetBase}${name}.${hash}a.js`);
      if (urls.length >= maxChunks) break;
    }
    return urls;
  };

  /** Chunk-map bodies are JS object literals with numeric-literal keys (incl. 9e3 exponents). */
  const parseChunkMap = (body: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of body.matchAll(MAP_PAIR)) out[String(Number(m[2]))] = m[3] as string;
    return out;
  };

  const missing = (found: Partial<GraphqlOps>): OpName[] =>
    OP_NAMES.filter((op) => found[op] === undefined);

  const scrape = async (): Promise<GraphqlOps> => {
    const html = await fetchText(homeUrl);
    const found: Partial<GraphqlOps> = {};
    for (const url of [...entryBundleUrls(html), ...candidateChunkUrls(html)]) {
      if (missing(found).length === 0) break;
      Object.assign(found, parseOps(await fetchText(url), missing(found)));
    }
    if (missing(found).length > 0) throw new Error("GraphQL ops not found in X bundles");
    return found as GraphqlOps;
  };

  const scrapeAndStore = async (): Promise<GraphqlOps> => {
    try {
      const ops = await scrape();
      memo = ops;
      // A cache write failure (quota, storage shutdown) must not lose the fresh ids.
      await deps.cache.write({ ops, fetchedAt: now() }).catch(() => {});
      return ops;
    } catch {
      return deps.fallback;
    }
  };

  return {
    async resolve() {
      if (memo) return memo;
      try {
        const cached = await deps.cache.read();
        if (cached && now() - cached.fetchedAt < ttl) return (memo = cached.ops);
      } catch {
        // A broken cache behaves as no cache.
      }
      return scrapeAndStore();
    },
    refresh: scrapeAndStore,
  };
}
