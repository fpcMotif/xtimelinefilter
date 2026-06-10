import type { TweetAuthor } from "@/core/selection-store";

import { fetchOwnedLists } from "./lists-provider";
import { type Credentials, XApiError, type XList, type XListApi } from "./types";

const BASE = "https://x.com/i/api/1.1";

export interface RestDeps {
  fetch: typeof fetch;
  creds: Credentials;
}

function authHeaders(creds: Credentials): Record<string, string> {
  return {
    authorization: `Bearer ${creds.bearer}`,
    "x-csrf-token": creds.csrf,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
  };
}

async function ensureOk(res: Response): Promise<unknown> {
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
  const errors = (json as { errors?: Array<{ code?: number; message?: string }> } | undefined)
    ?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const message = errors.map((e) => e.message ?? "").join("; ");
    const codes = errors.map((e) => e.code);
    if (/already a member|already added/i.test(message)) {
      throw new XApiError("already-member", message);
    }
    if (codes.includes(32) || codes.includes(89)) throw new XApiError("auth", message);
    throw new XApiError("unknown", message || "v1.1 error");
  }
  if (!res.ok) throw new XApiError("unknown", `HTTP ${res.status}`);
  return json;
}

/** POST a v1.1 endpoint with form-encoded params + the session auth headers. */
async function post(deps: RestDeps, path: string, params: Record<string, string>): Promise<void> {
  const res = await deps.fetch(`${BASE}/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { ...authHeaders(deps.creds), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  await ensureOk(res);
}

export const addToList = (deps: RestDeps, listId: string, screenName: string): Promise<void> =>
  post(deps, "lists/members/create.json", { list_id: listId, screen_name: screenName });

export const removeFromList = (deps: RestDeps, listId: string, screenName: string): Promise<void> =>
  post(deps, "lists/members/destroy.json", { list_id: listId, screen_name: screenName });

export const muteUser = (deps: RestDeps, screenName: string): Promise<void> =>
  post(deps, "mutes/users/create.json", { screen_name: screenName });

export const blockUser = (deps: RestDeps, screenName: string): Promise<void> =>
  post(deps, "blocks/create.json", { screen_name: screenName });

/**
 * DEFAULT backend: X's stable v1.1 REST API (live-verified). Locale-independent,
 * no DOM driving, no GraphQL query-id drift, no id resolution (uses screen_name).
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

  getLists(): Promise<XList[]> {
    return fetchOwnedLists(this.deps());
  }

  async resolveUserId(_screenName: string): Promise<string | null> {
    return null; // not needed — v1.1 list mutations take screen_name
  }

  addMember(list: XList, author: TweetAuthor): Promise<void> {
    return addToList(this.deps(), list.id, author.screenName);
  }

  removeMember(list: XList, author: TweetAuthor): Promise<void> {
    return removeFromList(this.deps(), list.id, author.screenName);
  }
}
