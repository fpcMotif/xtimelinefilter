import type { TweetAuthor } from "@/core/selection-store";

import {
  type Credentials,
  type GraphqlConfig,
  XApiError,
  type XList,
  type XListApi,
} from "./types";
import { authHeaders, ensureOk, GRAPHQL_PROFILE } from "./x-http";

export interface GraphqlDeps {
  fetch: typeof fetch;
  config: GraphqlConfig;
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
    await this.mutateMember("ListAddMember", this.deps.config.ops.ListAddMember, list.id, userId);
  }

  async removeMember(list: XList, author: TweetAuthor): Promise<void> {
    const userId = await this.requireUserId(author);
    await this.mutateMember(
      "ListRemoveMember",
      this.deps.config.ops.ListRemoveMember,
      list.id,
      userId,
    );
  }

  private async requireUserId(author: TweetAuthor): Promise<string> {
    const userId = author.userId ?? (await this.resolveUserId(author.screenName));
    if (!userId) throw new XApiError("not-found", `Could not resolve @${author.screenName}`);
    return userId;
  }

  private async resolveUserId(screenName: string): Promise<string | null> {
    const op = this.deps.config.ops.UserByScreenName;
    const params = new URLSearchParams({
      variables: JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true }),
      features: JSON.stringify(this.deps.config.features),
    });
    const url = `${this.deps.config.baseUrl}/${op}/UserByScreenName?${params.toString()}`;
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
