import type { GraphqlConfig } from "./types";

export interface SniffedOp {
  opName: string;
  queryId: string;
  features?: Record<string, boolean>;
}

const GQL_PATH_RE = /\/i\/api\/graphql\/([^/]+)\/([^/?]+)/;
const TRACKED: readonly string[] = ["ListAddMember", "ListRemoveMember", "UserByScreenName"];

/** Parse an x.com GraphQL request into {opName, queryId, features?}; null if not GraphQL. */
export function parseGraphqlRequest(url: string, body?: string | null): SniffedOp | null {
  const m = url.match(GQL_PATH_RE);
  const queryId = m?.[1];
  const opName = m?.[2];
  if (!queryId || !opName) return null;

  let features: Record<string, boolean> | undefined;
  try {
    const f = new URL(url, "https://x.com").searchParams.get("features");
    if (f) features = JSON.parse(f);
  } catch {
    // ignore malformed query string
  }
  if (!features && body) {
    try {
      const parsed = JSON.parse(body) as { features?: Record<string, boolean> };
      if (parsed.features) features = parsed.features;
    } catch {
      // ignore non-JSON body
    }
  }
  return features ? { opName, queryId, features } : { opName, queryId };
}

export interface GraphqlSniffer {
  /** Record an observed request; updates tracked queryIds + merges features. */
  record(url: string, body?: string | null): void;
  /** Current config (seed merged with everything observed so far). */
  config(): GraphqlConfig;
}

/**
 * Keeps a live GraphqlConfig current by observing the app's own GraphQL traffic
 * (ADR-0004). Seed from DEFAULT_GRAPHQL_CONFIG; the MAIN-world fetch/XHR patch
 * (installGraphqlSniffer) feeds record(). queryIds rotate ~2–4 weekly.
 */
export function createGraphqlSniffer(seed: GraphqlConfig): GraphqlSniffer {
  const ops: GraphqlConfig["ops"] = { ...seed.ops };
  let features: Record<string, boolean> = { ...seed.features };

  return {
    record(url, body) {
      const op = parseGraphqlRequest(url, body ?? null);
      if (!op) return;
      if (TRACKED.includes(op.opName)) {
        ops[op.opName as keyof GraphqlConfig["ops"]] = op.queryId;
      }
      if (op.features) features = { ...features, ...op.features };
    },
    config() {
      return { baseUrl: seed.baseUrl, ops: { ...ops }, features: { ...features } };
    },
  };
}

/**
 * Wrap a fetch implementation so every call feeds the sniffer before delegating.
 * In production this wraps the page's window.fetch from the MAIN world; the
 * wrapping logic itself is unit-tested with a fake fetch.
 */
export function wrapFetchWithSniffer(
  originalFetch: typeof fetch,
  sniffer: GraphqlSniffer,
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      sniffer.record(url, typeof init?.body === "string" ? init.body : null);
    } catch {
      // never let sniffing break a real request
    }
    return originalFetch(input, init);
  };
}
