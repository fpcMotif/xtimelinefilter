import type { TweetAuthor } from "@/core/selection-store";

import {
  type Credentials,
  type GraphqlConfig,
  XApiError,
  type XList,
  type XListApi,
} from "./types";

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
      headers: this.authHeaders(),
    });
    const json = (await this.ensureOk(res)) as {
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
      headers: { ...this.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        variables: { listId: String(listId), userId: String(userId) },
        queryId,
      }),
    });
    await this.ensureOk(res);
  }

  private authHeaders(): Record<string, string> {
    return {
      authorization: `Bearer ${this.creds.bearer}`,
      "x-csrf-token": this.creds.csrf,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
    };
  }

  /** Throws a typed XApiError on any failure; returns parsed JSON on success. */
  private async ensureOk(res: Response): Promise<unknown> {
    if (res.status === 429) throw new XApiError("rate-limited", "Rate limited (HTTP 429)");
    if (res.status === 401 || res.status === 403) {
      throw new XApiError("auth", `Auth error (HTTP ${res.status})`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const errors = (json as { errors?: Array<{ message?: string; code?: number }> } | undefined)
      ?.errors;
    if (Array.isArray(errors) && errors.length > 0) throw classifyErrors(errors);
    if (!res.ok) throw new XApiError("unknown", `HTTP ${res.status}`);
    return json;
  }
}

function classifyErrors(errors: Array<{ message?: string; code?: number }>): XApiError {
  const message = errors.map((e) => e.message ?? "").join(" ; ");
  const lower = message.toLowerCase();
  const codes = errors.map((e) => e.code);
  if (lower.includes("already a member")) return new XApiError("already-member", message);
  if (codes.includes(88)) return new XApiError("rate-limited", message);
  if (codes.includes(104)) return new XApiError("protected", message);
  if (codes.includes(353) || codes.includes(32)) return new XApiError("auth", message);
  return new XApiError("unknown", message || "Unknown GraphQL error");
}
