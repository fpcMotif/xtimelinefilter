import type { TweetAuthor } from "@/core/selection-store";

import {
  isGraphqlQueryId,
  type GraphqlOperationCatalog,
  type GraphqlOperationDescriptor,
  type GraphqlOperationName,
} from "./graphql-contract";
import type { GraphqlCatalogResolver } from "./graphql-ops";
import {
  type Credentials,
  type GraphqlClientConfig,
  XApiError,
  type XList,
  type XListApi,
} from "./types";
import { authHeaders, ensureOk, GRAPHQL_PROFILE } from "./x-http";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

class CatalogMismatchError extends Error {}

export interface GraphqlDeps {
  fetch: typeof fetch;
  config: GraphqlClientConfig;
  /** Complete operation contracts. Refresh can replace compatible query IDs only. */
  catalog: GraphqlCatalogResolver;
}

const sameBooleanMap = (left: Record<string, boolean>, right: Record<string, boolean>): boolean =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => right[key] === value);

const catalogsEqual = (left: GraphqlOperationCatalog, right: GraphqlOperationCatalog): boolean =>
  (Object.keys(left) as GraphqlOperationName[]).every((op) => {
    const a = left[op];
    const b = right[op];
    return (
      a.queryId === b.queryId &&
      sameBooleanMap(a.features, b.features) &&
      sameBooleanMap(a.fieldToggles ?? {}, b.fieldToggles ?? {})
    );
  });

/** Explicit opt-in X GraphQL backend. Each request uses its own atomic descriptor. */
export class GraphqlXListApi implements XListApi {
  readonly evidence = "server-response" as const;

  constructor(
    private readonly getCredentials: () => Credentials,
    private readonly deps: GraphqlDeps,
  ) {}

  async addMember(list: XList, author: TweetAuthor): Promise<void> {
    const userId = await this.requireUserId(author);
    await this.withCatalogRetry((catalog) =>
      this.mutateMember("ListAddMember", catalog.ListAddMember, list.id, userId),
    );
  }

  async removeMember(list: XList, author: TweetAuthor): Promise<void> {
    const userId = await this.requireUserId(author);
    await this.withCatalogRetry((catalog) =>
      this.mutateMember("ListRemoveMember", catalog.ListRemoveMember, list.id, userId),
    );
  }

  private async requireUserId(author: TweetAuthor): Promise<string> {
    const userId = author.userId ?? (await this.resolveUserId(author.screenName));
    if (!userId) throw new XApiError("not-found", `Could not resolve @${author.screenName}`);
    return userId;
  }

  private async resolveUserId(screenName: string): Promise<string | null> {
    return this.withCatalogRetry(async (catalog) => {
      const descriptor = catalog.UserByScreenName;
      const params = new URLSearchParams({
        variables: JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true }),
        features: JSON.stringify(descriptor.features),
      });
      if (descriptor.fieldToggles && Object.keys(descriptor.fieldToggles).length > 0) {
        params.set("fieldToggles", JSON.stringify(descriptor.fieldToggles));
      }
      const res = await this.deps.fetch(this.url("UserByScreenName", descriptor, params), {
        method: "GET",
        credentials: "include",
        headers: authHeaders(this.getCredentials()),
      });
      const data = await this.requireData(res, "UserByScreenName");
      const restId = (data as { user?: { result?: { rest_id?: unknown } } }).user?.result?.rest_id;
      return typeof restId === "string" ? restId : null;
    });
  }

  /** One refresh after a missing endpoint or narrow required-feature/toggle gateway failure. */
  private async withCatalogRetry<T>(
    call: (catalog: GraphqlOperationCatalog) => Promise<T>,
  ): Promise<T> {
    const current = await this.deps.catalog.resolve();
    try {
      return await call(current);
    } catch (error) {
      if (!(error instanceof CatalogMismatchError)) throw error;
      const refreshed = await this.deps.catalog.refresh();
      if (catalogsEqual(current, refreshed)) {
        throw new XApiError(
          "unknown",
          "GraphQL catalog is stale; X rejected its endpoint or required metadata and no compatible refresh was found.",
        );
      }
      try {
        return await call(refreshed);
      } catch (retryError) {
        if (retryError instanceof CatalogMismatchError) {
          throw new XApiError(
            "unknown",
            "GraphQL catalog is stale after one compatible refresh; X still rejected its endpoint or required metadata.",
          );
        }
        throw retryError;
      }
    }
  }

  private url(
    opName: GraphqlOperationName,
    descriptor: GraphqlOperationDescriptor,
    query?: URLSearchParams,
  ): string {
    if (!isGraphqlQueryId(descriptor.queryId)) {
      throw new XApiError("unknown", `Invalid GraphQL query ID for ${opName}`);
    }
    const path = `${this.deps.config.baseUrl}/${descriptor.queryId}/${opName}`;
    return query ? `${path}?${query.toString()}` : path;
  }

  private async mutateMember(
    opName: "ListAddMember" | "ListRemoveMember",
    descriptor: GraphqlOperationDescriptor,
    listId: string,
    userId: string,
  ): Promise<void> {
    const res = await this.deps.fetch(this.url(opName, descriptor), {
      method: "POST",
      credentials: "include",
      headers: { ...authHeaders(this.getCredentials()), "content-type": "application/json" },
      body: JSON.stringify({
        variables: { listId: String(listId), userId: String(userId) },
        features: descriptor.features,
        ...(descriptor.fieldToggles && Object.keys(descriptor.fieldToggles).length > 0
          ? { fieldToggles: descriptor.fieldToggles }
          : {}),
        queryId: descriptor.queryId,
      }),
    });
    const data = await this.requireMutationData(res, opName);
    if (!isRecord(data.list))
      throw new XApiError("unknown", `Malformed GraphQL ${opName} response`);
  }

  /**
   * GraphQL may return usable mutation data beside field-level errors. A valid
   * root List proves the mutation executed; rejecting it would invite a retry
   * after X already changed membership.
   */
  private async requireMutationData(
    res: Response,
    opName: "ListAddMember" | "ListRemoveMember",
  ): Promise<Record<string, unknown>> {
    await this.throwIfCatalogMismatch(res);
    const partial = await res
      .clone()
      .json()
      .catch(() => null);
    if (res.ok && isRecord(partial) && isRecord(partial.data)) {
      const errorsValid =
        !Object.hasOwn(partial, "errors") ||
        (Array.isArray(partial.errors) && partial.errors.every(isRecord));
      if (errorsValid && isRecord(partial.data.list)) return partial.data;
    }
    return this.requireData(res, opName);
  }

  private async requireData(
    res: Response,
    opName: GraphqlOperationName,
  ): Promise<Record<string, unknown>> {
    await this.throwIfCatalogMismatch(res);
    const json = await ensureOk(res, GRAPHQL_PROFILE);
    if (!isRecord(json) || !isRecord(json.data)) {
      throw new XApiError("unknown", `Malformed GraphQL ${opName} response`);
    }
    return json.data;
  }

  private async throwIfCatalogMismatch(res: Response): Promise<void> {
    if (res.status === 404) throw new CatalogMismatchError();
    if (res.status !== 400) return;
    const body = await res
      .clone()
      .json()
      .catch(() => null);
    const messages =
      isRecord(body) && Array.isArray(body.errors)
        ? body.errors
            .filter(isRecord)
            .map((error) => error.message)
            .filter((message): message is string => typeof message === "string")
        : [];
    if (
      messages.some(
        (message) =>
          /\b(?:feature|field[_ ]?toggle)s?\b/i.test(message) &&
          /\b(?:cannot be null|required|missing)\b/i.test(message),
      )
    ) {
      throw new CatalogMismatchError();
    }
  }
}
