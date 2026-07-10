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
    private readonly creds: Credentials,
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

  async resolveUserId(screenName: string): Promise<string | null> {
    const op = this.deps.config.ops.UserByScreenName;
    const params = new URLSearchParams({
      variables: JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true }),
      features: JSON.stringify(this.deps.config.features),
    });
    const url = `${this.deps.config.baseUrl}/${op}/UserByScreenName?${params.toString()}`;
    const res = await this.deps.fetch(url, {
      method: "GET",
      credentials: "include",
      headers: authHeaders(this.creds),
    });
    const json = (await ensureOk(res, GRAPHQL_PROFILE)) as {
      data?: { user?: { result?: { rest_id?: string } } };
    };
    const restId = json?.data?.user?.result?.rest_id;
    return typeof restId === "string" ? restId : null;
  }

  async getLists(): Promise<XList[]> {
    // TODO(next TDD cycle): implement via v1.1 lists/ownerships (simpler/stabler
    // than walking ListsManagementPageTimeline GraphQL). Tracked in blueprint §9.
    throw new XApiError("unknown", "GraphqlXListApi.getLists not implemented yet");
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
      headers: { ...authHeaders(this.creds), "content-type": "application/json" },
      body: JSON.stringify({
        variables: { listId: String(listId), userId: String(userId) },
        queryId,
      }),
    });
    await ensureOk(res, GRAPHQL_PROFILE);
  }
}
