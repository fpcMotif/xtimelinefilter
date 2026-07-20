/**
 * Where the Filter is allowed to run (spec §3): Home, List, Bookmarks, and
 * profile timelines. Each uses the same virtualized `cellInnerDiv` /
 * `article[data-testid="tweet"]` structure (research 03 §1), so the applier and
 * facet extraction work unchanged — the route was the only gate. The Bookmarks
 * clause is a positive match, not a deny-list edit: `i` and `bookmarks` must
 * stay reserved roots so bare `/<handle>` profile detection keeps rejecting
 * them. Unlike the List regex, it end-anchors (bookmark folders have no
 * sub-tabs), so a deeper `/i/bookmarks/<id>/…` path stays out.
 * x.com is a SPA, so callers re-evaluate on route change, not just page load.
 */
export function isInScope(pathname: string): boolean {
  return (
    pathname === "/home" ||
    /^\/i\/lists\/\d+(?:\/|$)/.test(pathname) ||
    /^\/i\/bookmarks(?:\/\d+)?\/?$/.test(pathname) ||
    isProfileTimeline(pathname)
  );
}

/**
 * x.com top-level paths that are NOT a profile: a bare `/<seg>` route only means
 * a profile when the first segment isn't one of X's own reserved routes. Kept
 * ahead of an X redesign that adds nav destinations (ADR-0004 spirit) — an
 * unknown route here only mis-mounts the filter UI on a page with no tweet cells
 * (a harmless no-op; the applier finds nothing to hide), never breaks anything.
 */
const RESERVED_ROOTS = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "compose",
  "search",
  "settings",
  "i",
  "bookmarks",
  "lists",
  "communities",
  "hashtag",
  "jobs",
  "premium",
  "verified_choose",
  "account",
  "personalization",
  "intent",
  "share",
  "login",
  "logout",
  "signup",
  "flow",
  "tos",
  "privacy",
  "rules",
  "about",
  "download",
  "topics",
  "connect_people",
  "follower_requests",
]);

/**
 * Profile sub-tabs that are still post timelines (`with_replies`, `likes`) or
 * harmless grids the applier just no-ops over (`media`, `highlights`, …). Listing
 * them — rather than allowing any 2nd segment — keeps `/<handle>/status/<id>` and
 * the `/photo` lightbox out of scope.
 */
const PROFILE_TABS = new Set([
  "with_replies",
  "media",
  "likes",
  "highlights",
  "articles",
  "affiliates",
  "superfollows",
]);

/**
 * A profile timeline is `/<handle>` or `/<handle>/<tab>`: handle is X's
 * `[A-Za-z0-9_]{1,15}` and not a reserved root; the optional 2nd segment must be
 * a known profile tab.
 */
function isProfileTimeline(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return false;
  const handle = segments[0]!;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return false;
  if (RESERVED_ROOTS.has(handle.toLowerCase())) return false;
  return segments.length === 1 || PROFILE_TABS.has(segments[1]!);
}

/**
 * Fire `cb` on SPA navigations (pushState/replaceState/popstate). Returns an
 * unsubscribe. Patches history once; multiple subscribers share the patch.
 */
let patched = false;
const listeners = new Set<() => void>();

function ensurePatched(): void {
  if (patched) return;
  patched = true;
  for (const name of ["pushState", "replaceState"] as const) {
    const original = history[name];
    history[name] = function patchedHistory(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = original.apply(this, args);
      for (const cb of listeners) cb();
      return result;
    } as History[typeof name];
  }
  window.addEventListener("popstate", () => {
    for (const cb of listeners) cb();
  });
}

export function onRouteChange(cb: () => void): () => void {
  ensurePatched();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
