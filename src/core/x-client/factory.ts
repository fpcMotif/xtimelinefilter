import type { BackendStrategy } from "@/core/settings";

import { DomXListApi } from "./dom-api";
import { GraphqlXListApi } from "./graphql-api";
import { DEFAULT_GRAPHQL_CONFIG } from "./graphql-config";
import type { PageDriver } from "./page-driver";
import { RestXListApi } from "./rest-api";
import type { Credentials, XListApi } from "./types";

/** Runtime-only collaborators. Concrete backend wiring stays here. */
export interface XListApiRuntime {
  fetch: typeof fetch;
  credentials(): Credentials;
  createPageDriver(): PageDriver;
}

/**
 * The only place that knows concrete list backends (ADR-0001). REST resolves
 * credentials per request; DOM creates its driver only when selected; GraphQL
 * also reads credentials per request. The current default is undocumented web v1.1
 * REST, whose endpoint contract may change.
 */
export function createXListApi(strategy: BackendStrategy, runtime: XListApiRuntime): XListApi {
  if (strategy === "graphql") {
    return new GraphqlXListApi(runtime.credentials, {
      fetch: runtime.fetch,
      config: DEFAULT_GRAPHQL_CONFIG,
    });
  }
  if (strategy === "dom") return new DomXListApi(runtime.createPageDriver());
  return new RestXListApi(runtime.fetch, () => runtime.credentials());
}
