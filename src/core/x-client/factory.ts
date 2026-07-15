import type { BackendStrategy } from "@/core/settings";

import type { Auth } from "./auth";
import { DomXListApi } from "./dom-api";
import { createDomPageDriver } from "./dom-page-driver";
import { GraphqlXListApi } from "./graphql-api";
import { DEFAULT_GRAPHQL_CONFIG } from "./graphql-config";
import { RestXListApi } from "./rest-api";
import type { XListApi } from "./types";

export interface BackendDeps {
  fetch: typeof fetch;
  auth: Auth;
}

/**
 * The only place that knows the concrete backends (ADR-0001); default is the
 * v1.1 REST backend. Straight-line dispatch keeps it lazy — only the selected
 * branch constructs, so an unused backend's live deps are never built and only
 * GraphQL snapshots `auth.credentials()` eagerly (REST defers it behind a thunk,
 * DOM never touches it), which matters because `credentials()` throws with no ct0.
 */
export function createXListApi(strategy: BackendStrategy, deps: BackendDeps): XListApi {
  if (strategy === "graphql")
    return new GraphqlXListApi(deps.auth.credentials(), {
      fetch: deps.fetch,
      config: DEFAULT_GRAPHQL_CONFIG,
    });
  if (strategy === "dom") return new DomXListApi(createDomPageDriver());
  return new RestXListApi(deps.fetch, () => deps.auth.credentials());
}
