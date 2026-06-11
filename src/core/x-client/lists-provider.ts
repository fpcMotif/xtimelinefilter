import { type Credentials, XApiError, type XList } from "./types";

export interface ListsProviderDeps {
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

interface RawList {
  id_str?: string;
  id?: number;
  name?: string;
  member_count?: number;
  mode?: string;
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
    headers: authHeaders(deps.creds),
  });
  if (res.status === 429) {
    const raw = Number(res.headers.get("x-rate-limit-reset"));
    throw new XApiError("rate-limited", "lists/ownerships rate limited", {
      resetAt: Number.isFinite(raw) && raw > 0 ? raw : undefined,
    });
  }
  if (res.status === 401 || res.status === 403) {
    throw new XApiError("auth", `lists/ownerships auth error (HTTP ${res.status})`);
  }
  if (!res.ok) throw new XApiError("unknown", `lists/ownerships HTTP ${res.status}`);

  const json = (await res.json()) as { lists?: RawList[] };
  return (json.lists ?? [])
    .map((l) => ({
      id: l.id_str ?? (l.id !== undefined ? String(l.id) : ""),
      name: l.name ?? "",
      memberCount: l.member_count,
      ...(l.mode !== undefined ? { isPrivate: l.mode === "private" } : {}),
    }))
    .filter((l) => l.id !== "" && l.name !== "");
}

/**
 * Ids of the user's OWN Lists that already contain `screenName` — powers the
 * picker's "already in" blue checks (story beat 4). Best-effort: any failure
 * returns [] so a flaky membership lookup can never block the picker.
 */
export async function fetchMembershipListIds(
  deps: ListsProviderDeps,
  screenName: string,
): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      screen_name: screenName,
      filter_to_owned_lists: "true",
      count: "100",
    });
    const res = await deps.fetch(`https://x.com/i/api/1.1/lists/memberships.json?${params}`, {
      method: "GET",
      credentials: "include",
      headers: authHeaders(deps.creds),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { lists?: RawList[] };
    return (json.lists ?? [])
      .map((l) => l.id_str ?? (l.id !== undefined ? String(l.id) : ""))
      .filter((id) => id !== "");
  } catch {
    return [];
  }
}
