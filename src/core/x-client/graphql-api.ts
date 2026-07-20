import type { TweetAuthor } from "@/core/selection-store";

import type { GraphqlOpsResolver } from "./graphql-ops";
import {
  type Credentials,
  type GraphqlConfig,
  type GraphqlOps,
  XApiError,
  type XList,
  type XListApi,
} from "./types";
import { authHeaders, ensureOk, GRAPHQL_PROFILE } from "./x-http";

export interface GraphqlDeps {
  fetch: typeof fetch;
  config: GraphqlConfig;
  /** Query-id source; a rotated-id 404 triggers one refresh + retry, then the typed failure. */
  ops: GraphqlOpsResolver;
}

/**
 * Opt-in backend that talks to x.com's internal GraphQL endpoints from the
 * content script (same-origin: the browser attaches the session cookies, we add
 * the ct0 csrf + bearer headers). queryId lives in the URL path; ids are strings.
 */
export class GraphqlXListApi implements XListApi {
  constructor(
    private readonly getCredentials: () => Credentials,
    private readonly deps: GraphqlDeps,
  ) {}

  async addMember(list: XList, author: TweetAuthor): Promise<void> {
    const userId = await this.requireUserId(author);
    await this.withOpsRetry((ops) =>
      this.mutateMember("ListAddMember", ops.ListAddMember, list.id, userId),
    );
  }

  async removeMember(list: XList, author: TweetAuthor): Promise<void> {
    const userId = await this.requireUserId(author);
    await this.withOpsRetry((ops) =>
      this.mutateMember("ListRemoveMember", ops.ListRemoveMember, list.id, userId),
    );
  }

  private async requireUserId(author: TweetAuthor): Promise<string> {
    const userId = author.userId ?? (await this.resolveUserId(author.screenName));
    if (!userId) throw new XApiError("not-found", `Could not resolve @${author.screenName}`);
    return userId;
  }

  private async resolveUserId(screenName: string): Promise<string | null> {
    return this.withOpsRetry(async (ops) => {
      const params = new URLSearchParams({
        variables: JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true }),
        features: JSON.stringify(this.deps.config.features),
      });
      const url = `${this.deps.config.baseUrl}/${ops.UserByScreenName}/UserByScreenName?${params.toString()}`;
      const res = await this.deps.fetch(url, {
        method: "GET",
        credentials: "include",
        headers: authHeaders(this.getCredentials()),
      });
      const json = (await this.ensureOk(res, "UserByScreenName")) as {
        data?: { user?: { result?: { rest_id?: string } } };
      };
      const restId = json?.data?.user?.result?.rest_id;
      return typeof restId === "string" ? restId : null;
    });
  }

  /**
   * One endpoint call with resolved query ids; on the rotated-id 404 boundary it
   * forces one re-scrape and retries once. Only endpoint 404s can land in the catch —
   * the "Could not resolve @handle" not-found is thrown by requireUserId, outside
   * this wrapper, and never triggers a refresh.
   */
  private async withOpsRetry<T>(call: (ops: GraphqlOps) => Promise<T>): Promise<T> {
    try {
      return await call(await this.deps.ops.resolve());
    } catch (error) {
      if (!(error instanceof XApiError && error.kind === "not-found")) throw error;
      return call(await this.deps.ops.refresh());
    }
  }

  private async mutateMember(
    opName: string,
    queryId: string,
    listId: string,
    userId: string,
  ): Promise<void> {
    const url = `${this.deps.config.baseUrl}/${queryId}/${opName}`;
    const res = await this.deps.fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { ...authHeaders(this.getCredentials()), "content-type": "application/json" },
      body: JSON.stringify({
        variables: { listId: String(listId), userId: String(userId) },
        queryId,
      }),
    });
    await this.ensureOk(res, opName);
  }

  /** A static query id can rotate; report that boundary failure plainly and typed. */
  private ensureOk(res: Response, opName: string): Promise<unknown> {
    if (res.status === 404) {
      throw new XApiError(
        "not-found",
        `GraphQL ${opName} endpoint was not found; its query ID may have rotated.`,
      );
    }
    return ensureOk(res, GRAPHQL_PROFILE);
  }
}
