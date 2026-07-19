import { type Credentials, XApiError, type XList } from "./types";
import { authHeaders, ensureOk, REST_PROFILE } from "./x-http";

export interface ListsProviderDeps {
  fetch: typeof fetch;
  creds: Credentials;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const malformedCatalog = (): XApiError => new XApiError("unknown", "Malformed List catalog");

const isCursor = (value: string): boolean => /^(?:0|-?[1-9]\d*)$/.test(value);

/** X List ids are positive decimal snowflakes; never coerce an invalid wire value. */
function listIdOf(value: unknown): string | null {
  /* v8 ignore next -- parseOwnedList admits only records before delegating here. */
  if (!isRecord(value)) return null;
  if (hasOwn(value, "id_str")) {
    return typeof value.id_str === "string" && /^[1-9]\d*$/.test(value.id_str)
      ? value.id_str
      : null;
  }
  return typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0
    ? String(value.id)
    : null;
}

function parseOwnedList(value: unknown): XList | null {
  if (!isRecord(value)) return null;
  const id = listIdOf(value);
  if (!id || typeof value.name !== "string" || value.name.trim() === "") return null;
  const list: XList = { id, name: value.name };
  if (
    typeof value.member_count === "number" &&
    Number.isFinite(value.member_count) &&
    value.member_count >= 0
  ) {
    list.memberCount = value.member_count;
  }
  if (value.mode === "private") list.isPrivate = true;
  else if (value.mode === "public") list.isPrivate = false;
  return list;
}

/** A page must name a canonical next cursor; the string form preserves 64-bit precision. */
function nextCursorOf(page: Record<string, unknown>): string | null {
  const stringCursor = hasOwn(page, "next_cursor_str") ? page.next_cursor_str : undefined;
  if (stringCursor !== undefined) {
    return typeof stringCursor === "string" && isCursor(stringCursor) ? stringCursor : null;
  }

  const numericCursor = hasOwn(page, "next_cursor") ? page.next_cursor : undefined;
  return typeof numericCursor === "number" && Number.isSafeInteger(numericCursor)
    ? String(numericCursor)
    : null;
}

function ownershipsUrl(cursor: string): string {
  const params = new URLSearchParams({ count: "1000", cursor });
  return `https://x.com/i/api/1.1/lists/ownerships.json?${params}`;
}

function membershipsUrl(screenName: string, cursor: string): string {
  const params = new URLSearchParams({
    screen_name: screenName,
    filter_to_owned_lists: "true",
    count: "1000",
    cursor,
  });
  return `https://x.com/i/api/1.1/lists/memberships.json?${params}`;
}

/**
 * Loads the user's OWN Lists through X's undocumented web v1.1 ownerships endpoint,
 * which may change. This is list *discovery*, separate from list *mutation* (the
 * XListApi backends), so the picker populates regardless of the selected backend.
 * Same-origin fetch from the content script carries the session; we add ct0 + bearer.
 */
export async function fetchOwnedLists(deps: ListsProviderDeps): Promise<XList[]> {
  const listsById = new Map<string, XList>();
  const seenCursors = new Set<string>();
  let cursor = "-1";

  while (true) {
    /* v8 ignore next -- every successor is rejected below before it can loop back. */
    if (seenCursors.has(cursor)) throw malformedCatalog();
    seenCursors.add(cursor);

    const res = await deps.fetch(ownershipsUrl(cursor), {
      method: "GET",
      credentials: "include",
      headers: authHeaders(deps.creds),
    });
    const json = await ensureOk(res, REST_PROFILE);
    if (!isRecord(json) || !Array.isArray(json.lists)) throw malformedCatalog();

    for (const rawList of json.lists) {
      const list = parseOwnedList(rawList);
      if (!list) throw malformedCatalog();
      if (!listsById.has(list.id)) listsById.set(list.id, list);
    }

    const nextCursor = nextCursorOf(json);
    if (!nextCursor) throw malformedCatalog();
    if (nextCursor === "0") return [...listsById.values()];
    if (seenCursors.has(nextCursor)) throw malformedCatalog();
    cursor = nextCursor;
  }
}

/**
 * Ids of the user's OWN Lists that already contain `screenName` — powers the
 * picker's "already in" blue checks (story beat 4). A failed or malformed read
 * returns `null`: callers must keep membership unknown, never infer empty.
 */
export async function fetchMembershipListIds(
  deps: ListsProviderDeps,
  screenName: string,
): Promise<string[] | null> {
  try {
    const ids = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor = "-1";

    while (true) {
      /* v8 ignore next -- every successor is rejected below before it can loop back. */
      if (seenCursors.has(cursor)) return null;
      seenCursors.add(cursor);

      const res = await deps.fetch(membershipsUrl(screenName, cursor), {
        method: "GET",
        credentials: "include",
        headers: authHeaders(deps.creds),
      });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      if (!isRecord(json) || !Array.isArray(json.lists)) return null;

      for (const rawList of json.lists) {
        const id = listIdOf(rawList);
        if (!id) return null;
        ids.add(id);
      }

      const nextCursor = nextCursorOf(json);
      if (!nextCursor) return null;
      if (nextCursor === "0") return [...ids];
      if (seenCursors.has(nextCursor)) return null;
      cursor = nextCursor;
    }
  } catch {
    return null;
  }
}
