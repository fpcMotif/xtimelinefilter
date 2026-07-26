import { decideCacheObservation, type CacheObservation } from "@/core/cache-observation";

import {
  GRAPHQL_OPERATION_NAMES,
  isGraphqlQueryId,
  type GraphqlOperationCatalog,
  type GraphqlOperationName,
} from "./graphql-contract";

/** Persisted, compatible bundle result. A catalog shape change gets a new key. */
export interface GraphqlCatalogCacheEntry {
  catalog: GraphqlOperationCatalog;
  fetchedAt: number;
}

/** Storage seam for full catalogs (chrome.storage in the extension, memory in tests). */
export interface GraphqlCatalogCache {
  read(): Promise<GraphqlCatalogCacheEntry | null>;
  begin(): Promise<CacheObservation>;
  write(
    entry: GraphqlCatalogCacheEntry,
    token: CacheObservation,
  ): Promise<GraphqlCatalogCacheEntry | void>;
}

/** Resolves complete, compatible GraphQL operation contracts. */
export interface GraphqlCatalogResolver {
  /** Cached-fresh catalog, else compatible bundle IDs, else the complete static fallback. */
  resolve(): Promise<GraphqlOperationCatalog>;
  /** Forces one bundle read. It returns the fallback when metadata is incompatible. */
  refresh(): Promise<GraphqlOperationCatalog>;
}

export interface GraphqlCatalogResolverDeps {
  fetch: typeof fetch;
  cache: GraphqlCatalogCache;
  /** Complete static contract. Bundle data may replace query IDs only. */
  fallback: GraphqlOperationCatalog;
  now?: () => number;
  ttlMs?: number;
  homeUrl?: string;
  assetBaseUrl?: string;
  candidateChunkPattern?: RegExp;
  /** Maximum entry bundles read from the home document. */
  maxEntryBundleFetches?: number;
  maxChunkFetches?: number;
}

const EXPECTED_OPERATION_TYPES = {
  ListAddMember: "mutation",
  ListRemoveMember: "mutation",
  UserByScreenName: "query",
} as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ENTRY_SCRIPT = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[^"'\s]+?\.js/g;
const MAIN_BUNDLE = /\/main\.[a-f0-9]+\.js$/;
const CHUNK_MAP =
  /\.u=(\w+)=>""\+\(\(\{([^}]*)\}\)\[\1\]\|\|\1\)\+"\."\+\(\{([^}]*)\}\)\[\1\]\+"a\.js"/;
const MAP_PAIR = /(?:^|,)(\w+):"((?:[^"\\]|\\.)*)"/g;
const WEBPACK_EXPORT = /[A-Za-z_$][\w$]*\.exports\s*=\s*/y;
const REGEX_AFTER_WORD = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "finally",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "try",
  "typeof",
  "void",
  "yield",
]);
const CONTROL_PAREN_WORD = new Set(["catch", "for", "if", "switch", "while", "with"]);

type LooseValue = string | boolean | LooseValue[] | { [key: string]: LooseValue } | null;
type LooseRecord = { [key: string]: LooseValue };
type OperationType = (typeof EXPECTED_OPERATION_TYPES)[GraphqlOperationName];
type OperationMetadata = {
  queryId: string;
  operationType: OperationType;
  features: Set<string>;
  fieldToggles: Set<string>;
};
type ParsedMetadata = {
  descriptors: Partial<Record<GraphqlOperationName, OperationMetadata>>;
  invalid: boolean;
};

/** In-memory catalog persistence for tests and non-extension factory wiring. */
export function createMemoryCatalogCache(): GraphqlCatalogCache {
  const epoch = "00000000-0000-4000-8000-000000000001";
  let clock: CacheObservation = { epoch, sequence: 0 };
  let entry: (GraphqlCatalogCacheEntry & { observation: CacheObservation }) | null = null;
  return {
    read: async () =>
      decideCacheObservation(clock, entry?.observation) === "existing" && entry
        ? { catalog: entry.catalog, fetchedAt: entry.fetchedAt }
        : null,
    begin: async () => ({ ...clock, sequence: ++clock.sequence }),
    write: async (next, token) => {
      const decision = decideCacheObservation(clock, entry?.observation, token);
      if (decision === "existing" && entry)
        return { catalog: entry.catalog, fetchedAt: entry.fetchedAt };
      if (decision === "empty") return undefined;
      entry = { ...next, observation: token };
      return next;
    },
  };
}

/** Reads one quoted JavaScript string without evaluating bundle text. */
function readString(text: string, start: number): [string, number] | null {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let out = "";
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === quote) return [out, at + 1];
    if (char === "\\") {
      const next = text[at + 1];
      if (next === undefined) return null;
      out += next;
      at += 1;
    } else out += char;
  }
  return null;
}

/** Skips one regex literal, including escapes and character classes. */
function readRegex(text: string, start: number): number | null {
  let inClass = false;
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === "\\") {
      at += 1;
      continue;
    }
    if (char === "\n" || char === "\r") return null;
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return at + 1;
  }
  return null;
}

const readWord = (text: string, start: number): string | null => {
  const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(start));
  return match?.[0] ?? null;
};

const boundedCount = (value: number | undefined, fallback: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;

/** Parses the narrow object/array/string grammar used by X operation metadata. */
function parseLooseValue(text: string, at: number): [LooseValue, number] | null {
  while (/\s/.test(text[at] ?? "")) at += 1;
  const char = text[at];
  if (char === '"' || char === "'" || char === "`") return readString(text, at);
  if (char === "{") {
    const record: LooseRecord = {};
    at += 1;
    while (true) {
      while (/\s/.test(text[at] ?? "")) at += 1;
      if (text[at] === "}") return [record, at + 1];
      const keyString = readString(text, at);
      let key: string;
      if (keyString) [key, at] = keyString;
      else {
        const keyMatch = /^[A-Za-z_$][\w$]*/.exec(text.slice(at));
        if (!keyMatch) return null;
        key = keyMatch[0];
        at += key.length;
      }
      while (/\s/.test(text[at] ?? "")) at += 1;
      if (text[at] !== ":") return null;
      const value = parseLooseValue(text, at + 1);
      if (!value) return null;
      [record[key], at] = value;
      while (/\s/.test(text[at] ?? "")) at += 1;
      if (text[at] === "}") return [record, at + 1];
      if (text[at] !== ",") return null;
      at += 1;
    }
  }
  if (char === "[") {
    const values: LooseValue[] = [];
    at += 1;
    while (true) {
      while (/\s/.test(text[at] ?? "")) at += 1;
      if (text[at] === "]") return [values, at + 1];
      const value = parseLooseValue(text, at);
      if (!value) return null;
      values.push(value[0]);
      at = value[1];
      while (/\s/.test(text[at] ?? "")) at += 1;
      if (text[at] === "]") return [values, at + 1];
      if (text[at] !== ",") return null;
      at += 1;
    }
  }
  if (text.startsWith("true", at)) return [true, at + 4];
  if (text.startsWith("false", at)) return [false, at + 5];
  if (text.startsWith("null", at)) return [null, at + 4];
  return null;
}

const isRecord = (value: LooseValue | undefined): value is LooseRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const stringSet = (value: LooseValue | undefined): Set<string> | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? new Set(value) : null;

const sameNames = (left: Iterable<string>, right: Iterable<string>): boolean => {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((name) => b.has(name));
};

const sameDescriptor = (left: OperationMetadata, right: OperationMetadata): boolean =>
  left.queryId === right.queryId &&
  left.operationType === right.operationType &&
  sameNames(left.features, right.features) &&
  sameNames(left.fieldToggles, right.fieldToggles);

/**
 * Reads only a balanced object directly assigned by webpack as `identifier.exports =`.
 * Other object literals, including strings and comments, are not operation descriptors.
 */
function operationMetadata(text: string): ParsedMetadata {
  const found: ParsedMetadata["descriptors"] = {};
  let invalid = false;
  let regexAllowed = true;
  let controlParenPending = false;
  const parenStack: boolean[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '"' || text[at] === "'" || text[at] === "`") {
      const string = readString(text, at);
      if (!string) return { descriptors: {}, invalid: true };
      at = string[1] - 1;
      regexAllowed = false;
      continue;
    }
    if (text.startsWith("//", at)) {
      const end = text.indexOf("\n", at + 2);
      at = end === -1 ? text.length : end;
      continue;
    }
    if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      if (end === -1) return { descriptors: {}, invalid: true };
      at = end + 1;
      continue;
    }
    if (text[at] === "/" && regexAllowed) {
      const end = readRegex(text, at);
      if (!end) return { descriptors: {}, invalid: true };
      at = end - 1;
      regexAllowed = false;
      continue;
    }
    // Sticky matching avoids allocating a suffix for every byte in a megabyte bundle.
    WEBPACK_EXPORT.lastIndex = at;
    const assignment = WEBPACK_EXPORT.exec(text);
    if (!assignment) {
      const word = readWord(text, at);
      if (word) {
        if (CONTROL_PAREN_WORD.has(word)) controlParenPending = true;
        regexAllowed = REGEX_AFTER_WORD.has(word);
        at += word.length - 1;
      } else if (text[at] === "(") {
        parenStack.push(controlParenPending);
        controlParenPending = false;
        regexAllowed = true;
      } else if (text[at] === ")") {
        regexAllowed = parenStack.pop() ?? false;
      } else if (text[at] === "]" || text[at] === ".") {
        regexAllowed = false;
      } else if (text[at] === "}") {
        // Ambiguous object-expression division may fall back; scanning a statement block must not
        // mistake the next regex literal for an export assignment.
        regexAllowed = true;
      } else if (!/\s/.test(text[at]!)) {
        regexAllowed = true;
      }
      continue;
    }
    const parsed = parseLooseValue(text, at + assignment[0].length);
    if (!parsed || !isRecord(parsed[0])) continue;
    const record = parsed[0];
    const op = record.operationName;
    const queryId = record.queryId;
    const operationType = record.operationType;
    const metadata = record.metadata;
    if (!GRAPHQL_OPERATION_NAMES.includes(op as GraphqlOperationName)) {
      at = parsed[1] - 1;
      continue;
    }
    const features = isRecord(metadata) ? stringSet(metadata.featureSwitches) : null;
    const fieldToggles =
      isRecord(metadata) && Object.hasOwn(metadata, "fieldToggles")
        ? stringSet(metadata.fieldToggles)
        : new Set<string>();
    const name = op as GraphqlOperationName;
    if (
      !isGraphqlQueryId(queryId) ||
      !isRecord(metadata) ||
      !features ||
      !fieldToggles ||
      operationType !== EXPECTED_OPERATION_TYPES[name]
    ) {
      invalid = true;
      at = parsed[1] - 1;
      continue;
    }
    const descriptor: OperationMetadata = {
      queryId,
      operationType: operationType as OperationType,
      features,
      fieldToggles,
    };
    const prior = found[name];
    if (prior && !sameDescriptor(prior, descriptor)) invalid = true;
    else found[name] = descriptor;
    at = parsed[1] - 1;
  }
  return { descriptors: found, invalid };
}

export function createGraphqlCatalogResolver(
  deps: GraphqlCatalogResolverDeps,
): GraphqlCatalogResolver {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? WEEK_MS;
  const homeUrl = deps.homeUrl ?? "https://x.com/";
  const assetBase = deps.assetBaseUrl ?? "https://abs.twimg.com/responsive-web/client-web/";
  const chunkPattern =
    deps.candidateChunkPattern ?? /LoggedInMain|UserLists|ListHandler|UserProfile/;
  const maxEntries = boundedCount(deps.maxEntryBundleFetches, 6);
  const maxChunks = boundedCount(deps.maxChunkFetches, 6);
  let memo: GraphqlOperationCatalog | null = null;
  let activeScrapes = 0;

  const fetchText = async (url: string): Promise<string> => {
    const res = await deps.fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`catalog scrape got HTTP ${res.status} for ${url}`);
    return res.text();
  };
  const entryBundleUrls = (html: string): string[] => {
    const urls = [...new Set(html.match(ENTRY_SCRIPT) ?? [])];
    // oxlint-disable-next-line unicorn/no-array-sort -- fresh array; Chrome 106 lacks toSorted().
    urls.sort((a, b) => Number(!MAIN_BUNDLE.test(a)) - Number(!MAIN_BUNDLE.test(b)));
    return urls.slice(0, maxEntries);
  };
  const parseChunkMap = (body: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const match of body.matchAll(MAP_PAIR)) out[String(Number(match[1]))] = match[2]!;
    return out;
  };
  const candidateChunkUrls = (html: string): string[] => {
    const match = CHUNK_MAP.exec(html);
    if (!match) return [];
    const names = parseChunkMap(match[2]!);
    const hashes = parseChunkMap(match[3]!);
    const candidates = Object.entries(names).filter(([, name]) => chunkPattern.test(name));
    // oxlint-disable-next-line unicorn/no-array-sort -- fresh array; Chrome 106 lacks toSorted().
    candidates.sort(
      (a, b) => Number(a[1] !== "bundle.LoggedInMain") - Number(b[1] !== "bundle.LoggedInMain"),
    );
    return candidates
      .flatMap(([id, name]) => (hashes[id] ? [`${assetBase}${name}.${hashes[id]}a.js`] : []))
      .slice(0, maxChunks);
  };
  const compatibleCatalog = (
    metadata: ParsedMetadata["descriptors"],
  ): GraphqlOperationCatalog | null => {
    const catalog = {} as GraphqlOperationCatalog;
    for (const op of GRAPHQL_OPERATION_NAMES) {
      const candidate = metadata[op];
      const fallback = deps.fallback[op];
      if (
        !candidate ||
        !isGraphqlQueryId(candidate.queryId) ||
        !sameNames(candidate.features, Object.keys(fallback.features)) ||
        !sameNames(candidate.fieldToggles, Object.keys(fallback.fieldToggles ?? {}))
      ) {
        return null;
      }
      catalog[op] = { ...fallback, queryId: candidate.queryId };
    }
    return catalog;
  };
  /** Cached IDs may survive, but this build's fallback owns all boolean values. */
  const compatibleCachedCatalog = (
    cached: GraphqlOperationCatalog,
  ): GraphqlOperationCatalog | null => {
    const catalog = {} as GraphqlOperationCatalog;
    for (const op of GRAPHQL_OPERATION_NAMES) {
      const descriptor = cached[op];
      const fallback = deps.fallback[op];
      if (
        !isGraphqlQueryId(descriptor.queryId) ||
        !sameNames(Object.keys(descriptor.features), Object.keys(fallback.features)) ||
        !sameNames(
          Object.keys(descriptor.fieldToggles ?? {}),
          Object.keys(fallback.fieldToggles ?? {}),
        )
      ) {
        return null;
      }
      catalog[op] = { ...fallback, queryId: descriptor.queryId };
    }
    return catalog;
  };
  const scrape = async (): Promise<GraphqlOperationCatalog> => {
    const html = await fetchText(homeUrl);
    const metadata: ParsedMetadata["descriptors"] = {};
    for (const url of [...entryBundleUrls(html), ...candidateChunkUrls(html)]) {
      const parsed = operationMetadata(await fetchText(url));
      if (parsed.invalid) throw new Error("GraphQL catalog has an invalid operation descriptor");
      for (const op of GRAPHQL_OPERATION_NAMES) {
        const candidate = parsed.descriptors[op];
        const prior = metadata[op];
        if (candidate && prior && !sameDescriptor(prior, candidate)) {
          throw new Error("GraphQL catalog has conflicting operation descriptors");
        }
        if (candidate) metadata[op] = candidate;
      }
    }
    const catalog = compatibleCatalog(metadata);
    if (!catalog) throw new Error("GraphQL catalog missing or incompatible with fallback metadata");
    return catalog;
  };
  const scrapeAndStore = async (): Promise<GraphqlOperationCatalog> => {
    activeScrapes += 1;
    try {
      const token = await deps.cache.begin().catch(() => null);
      const catalog = await scrape();
      const winner = token
        ? await deps.cache.write({ catalog, fetchedAt: now() }, token).catch(() => undefined)
        : undefined;
      const resolved = winner ? (compatibleCachedCatalog(winner.catalog) ?? catalog) : catalog;
      return (memo = resolved);
    } catch {
      return memo ?? (activeScrapes === 1 ? (memo = deps.fallback) : deps.fallback);
    } finally {
      activeScrapes -= 1;
    }
  };
  return {
    async resolve() {
      if (memo) return memo;
      try {
        const cached = await deps.cache.read();
        const age = cached ? now() - cached.fetchedAt : null;
        if (cached && typeof age === "number" && Number.isFinite(age) && age >= 0 && age < ttl) {
          const compatible = compatibleCachedCatalog(cached.catalog);
          if (compatible) return (memo = compatible);
        }
      } catch {
        // Broken storage is an empty cache.
      }
      return scrapeAndStore();
    },
    refresh: scrapeAndStore,
  };
}
