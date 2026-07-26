import type { CacheObservation } from "@/core/cache-observation";
import { requestGraphqlCatalog } from "@/core/protocol";
import type {
  GraphqlCatalogCache,
  GraphqlCatalogCacheEntry,
} from "@/packages/x-client/graphql-ops";

/** Content-side adapter for the worker-owned GraphQL catalog cache. */
export function createChromeCatalogCache(): GraphqlCatalogCache {
  return {
    async read() {
      const response = await requestGraphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "read",
      });
      return "entry" in response ? response.entry : null;
    },
    async begin(): Promise<CacheObservation> {
      const response = await requestGraphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "begin",
      });
      if (!("token" in response)) throw new Error("GraphQL cache token unavailable");
      return response.token;
    },
    async write(entry: GraphqlCatalogCacheEntry, token: CacheObservation) {
      const response = await requestGraphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token,
        catalog: entry.catalog,
      });
      return "entry" in response ? (response.entry ?? undefined) : undefined;
    },
  };
}
