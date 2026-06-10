import type { BackendStrategy } from "@/core/settings";

import type { XListApi } from "./types";

export interface BackendBuilders {
  rest(): XListApi;
  dom(): XListApi;
  graphql(): XListApi;
}

/**
 * The only place that knows the concrete backends (ADR-0001). Builders are
 * injected and called lazily so the unused backend's dependencies (live
 * PageDriver / Auth) are never constructed. Default is the v1.1 REST backend.
 */
export function createXListApi(strategy: BackendStrategy, builders: BackendBuilders): XListApi {
  if (strategy === "graphql") return builders.graphql();
  if (strategy === "dom") return builders.dom();
  return builders.rest();
}
