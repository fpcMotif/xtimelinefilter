import { type Credentials, XApiError, type XList } from "./types";

export interface ListsProviderDeps {
  fetch: typeof fetch;
  creds: Credentials;
}

/**
 * Loads the user's OWN Lists via the stable v1.1 ownerships endpoint (reference
 * repo's recommendation — simpler/stabler than GraphQL ids, ADR-0004). This is
 * list *discovery*, decoupled from list *mutation* (the XListApi backends), so the
 * picker populates regardless of which add-backend is active. Same-origin fetch
 * from the content script carries the session; we add ct0 + bearer.
 */
export async function fetchOwnedLists(deps: ListsProviderDeps): Promise<XList[]> {
  const res = await deps.fetch("https://x.com/i/api/1.1/lists/ownerships.json?count=100", {
    method: "GET",
    credentials: "include",
    headers: {
      authorization: `Bearer ${deps.creds.bearer}`,
      "x-csrf-token": deps.creds.csrf,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
    },
  });
  if (res.status === 429) throw new XApiError("rate-limited", "lists/ownerships rate limited");
  if (res.status === 401 || res.status === 403) {
    throw new XApiError("auth", `lists/ownerships auth error (HTTP ${res.status})`);
  }
  if (!res.ok) throw new XApiError("unknown", `lists/ownerships HTTP ${res.status}`);

  const json = (await res.json()) as {
    lists?: Array<{ id_str?: string; id?: number; name?: string; member_count?: number }>;
  };
  return (json.lists ?? [])
    .map((l) => ({
      id: l.id_str ?? (l.id !== undefined ? String(l.id) : ""),
      name: l.name ?? "",
      memberCount: l.member_count,
    }))
    .filter((l) => l.id !== "" && l.name !== "");
}
