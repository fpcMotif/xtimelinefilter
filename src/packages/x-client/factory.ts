import type { BackendStrategy } from "@/core/settings";

import { DomXListApi } from "./dom-api";
import { GraphqlXListApi } from "./graphql-api";
import { DEFAULT_GRAPHQL_CONFIG } from "./graphql-config";
import {
  createGraphqlCatalogResolver,
  createMemoryCatalogCache,
  type GraphqlCatalogResolver,
} from "./graphql-ops";
import type { PageDriver } from "./lib/page-driver";
import { RestXListApi } from "./rest-api";
import type { Credentials, XListApi } from "./types";

/** Runtime-only collaborators. Concrete backend wiring stays here. */
export interface XListApiRuntime {
  fetch: typeof fetch;
  credentials(): Credentials;
  createPageDriver(): PageDriver;
  /**
   * Query-id source for the GraphQL backend. Defaults to a resolver that scrapes
   * fresh ids from X's current bundles (memory-cached here; the extension passes
   * a chrome.storage-backed one) with the static config as fallback.
   */
  graphqlCatalog?: GraphqlCatalogResolver;
}

/**
 * The only place that knows concrete list backends (ADR-0001). REST resolves
 * credentials per request; DOM creates its driver only when selected; GraphQL
 * also reads credentials per request and self-heals rotated query ids through the
 * ops resolver. The current default is undocumented web v1.1 REST, whose endpoint
 * contract may change.
 */
export function createXListApi(strategy: BackendStrategy, runtime: XListApiRuntime): XListApi {
  if (strategy === "graphql") {
    return new GraphqlXListApi(runtime.credentials, {
      fetch: runtime.fetch,
      config: DEFAULT_GRAPHQL_CONFIG,
      catalog:
        runtime.graphqlCatalog ??
        createGraphqlCatalogResolver({
          fetch: runtime.fetch,
          cache: createMemoryCatalogCache(),
          fallback: DEFAULT_GRAPHQL_CONFIG.catalog,
        }),
    });
  }
  if (strategy === "dom") return new DomXListApi(runtime.createPageDriver());
  return new RestXListApi(runtime.fetch, () => runtime.credentials());
}
