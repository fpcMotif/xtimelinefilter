import { isCacheObservation, type CacheObservation } from "@/core/cache-observation";
import {
  isGraphqlCatalog,
  type GraphqlOperationCatalog,
} from "@/packages/x-client/graphql-contract";
export type GraphqlCatalogRequest =
  | { type: "lasso:graphql-catalog"; operation: "read" }
  | { type: "lasso:graphql-catalog"; operation: "begin" }
  | {
      type: "lasso:graphql-catalog";
      operation: "commit";
      token: CacheObservation;
      catalog: GraphqlOperationCatalog;
    };
export type GraphqlCatalogSuccess =
  | { entry: { catalog: GraphqlOperationCatalog; fetchedAt: number } | null }
  | { token: CacheObservation };
export type GraphqlCatalogResponse =
  | ({ ok: true } & GraphqlCatalogSuccess)
  | { ok: false; error: string };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function isGraphqlCatalogRequest(msg: unknown): msg is GraphqlCatalogRequest {
  if (!record(msg) || msg.type !== "lasso:graphql-catalog") return false;
  if (msg.operation === "read" || msg.operation === "begin") return Object.keys(msg).length === 2;
  return (
    msg.operation === "commit" &&
    isCacheObservation(msg.token) &&
    isGraphqlCatalog(msg.catalog) &&
    Object.keys(msg).every((key) => ["type", "operation", "token", "catalog"].includes(key))
  );
}
export async function requestGraphqlCatalog(
  request: GraphqlCatalogRequest,
): Promise<GraphqlCatalogResponse> {
  if (!isGraphqlCatalogRequest(request)) throw new Error("Invalid GraphQL catalog request");
  const response = await chrome.runtime.sendMessage(request);
  if (!record(response) || typeof response.ok !== "boolean")
    throw new Error("Invalid GraphQL catalog response");
  if (!response.ok) {
    if (typeof response.error !== "string") throw new Error("Invalid GraphQL catalog response");
    throw new Error(response.error);
  }
  if (request.operation === "begin") {
    if (!isCacheObservation(response.token)) throw new Error("Invalid GraphQL catalog response");
    return { ok: true, token: response.token };
  }
  const entry = response.entry;
  if (
    entry !== null &&
    (!record(entry) ||
      !isGraphqlCatalog(entry.catalog) ||
      typeof entry.fetchedAt !== "number" ||
      !Number.isSafeInteger(entry.fetchedAt) ||
      entry.fetchedAt < 0)
  )
    throw new Error("Invalid GraphQL catalog response");
  return {
    ok: true,
    entry: entry as { catalog: GraphqlOperationCatalog; fetchedAt: number } | null,
  };
}
