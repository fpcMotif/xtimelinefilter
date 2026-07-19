import type { TweetAuthor } from "@/core/selection-store";

import { type Credentials, type XList, type XListApi } from "./types";
import { authHeaders, ensureOk, REST_PROFILE } from "./x-http";

const BASE = "https://x.com/i/api/1.1";

export interface RestDeps {
  fetch: typeof fetch;
  creds: Credentials;
}

/** POST a v1.1 endpoint with form-encoded params + the session auth headers. */
async function post(deps: RestDeps, path: string, params: Record<string, string>): Promise<void> {
  const res = await deps.fetch(`${BASE}/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { ...authHeaders(deps.creds), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  await ensureOk(res, REST_PROFILE);
}

export const addToList = (deps: RestDeps, listId: string, screenName: string): Promise<void> =>
  post(deps, "lists/members/create.json", { list_id: listId, screen_name: screenName });

export const removeFromList = (deps: RestDeps, listId: string, screenName: string): Promise<void> =>
  post(deps, "lists/members/destroy.json", { list_id: listId, screen_name: screenName });

export const muteUser = (deps: RestDeps, screenName: string): Promise<void> =>
  post(deps, "mutes/users/create.json", { screen_name: screenName });

/** Undo verb for "Muted @jane" (story beat 6). */
export const unmuteUser = (deps: RestDeps, screenName: string): Promise<void> =>
  post(deps, "mutes/users/destroy.json", { screen_name: screenName });

export const blockUser = (deps: RestDeps, screenName: string): Promise<void> =>
  post(deps, "blocks/create.json", { screen_name: screenName });

/**
 * Current default: X's undocumented web v1.1 endpoints. They may change.
 * No DOM driving, no GraphQL query-id drift, no id resolution (uses screen_name).
 */
export class RestXListApi implements XListApi {
  // creds are read lazily per call so constructing the backend never throws
  // (ct0 may not be readable at startup / when logged out).
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly getCreds: () => Credentials,
  ) {}

  private deps(): RestDeps {
    return { fetch: this.fetchImpl, creds: this.getCreds() };
  }

  addMember(list: XList, author: TweetAuthor): Promise<void> {
    return addToList(this.deps(), list.id, author.screenName);
  }

  removeMember(list: XList, author: TweetAuthor): Promise<void> {
    return removeFromList(this.deps(), list.id, author.screenName);
  }
}
