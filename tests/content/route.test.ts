import { describe, expect, it, vi } from "vitest";

import { isInScope, onRouteChange, resolveScope } from "@/content/route";

/**
 * The Filter's scope identity (spec #31): which timeline a path is, not merely
 * whether the Filter may run there. Home, a List, and a profile are bindable —
 * they can carry their own preset. Bookmarks stays in Filter scope but is
 * deliberately not bindable yet, so it resolves to a scope with no key.
 */
describe("resolveScope", () => {
  it("resolves Home", () => {
    expect(resolveScope("/home")).toEqual({ kind: "home" });
  });

  it("resolves a List by its id, with or without a sub-tab", () => {
    expect(resolveScope("/i/lists/123")).toEqual({ kind: "list", listId: "123" });
    expect(resolveScope("/i/lists/123/members")).toEqual({ kind: "list", listId: "123" });
    expect(resolveScope("/i/lists/1234567890123456789")).toEqual({
      kind: "list",
      listId: "1234567890123456789",
    });
  });

  it("resolves Bookmarks and its folders as one non-bindable scope", () => {
    expect(resolveScope("/i/bookmarks")).toEqual({ kind: "bookmarks" });
    expect(resolveScope("/i/bookmarks/")).toEqual({ kind: "bookmarks" });
    expect(resolveScope("/i/bookmarks/123")).toEqual({ kind: "bookmarks" });
  });

  /**
   * X's History hub, which replaced the Bookmarks nav entry and now hosts
   * Bookmarks, Likes, Videos, and Articles as tabs under one root
   * (live-verified 2026-08-23: `/i/bookmarks` client-redirects to
   * `/i/history`, and its bare and `/likes` paths render the same tweet-cell
   * structure as Bookmarks). Every tab folds to one non-bindable scope, same
   * as Bookmarks' folders.
   */
  it("resolves History and its tabs as one non-bindable scope", () => {
    expect(resolveScope("/i/history")).toEqual({ kind: "history" });
    expect(resolveScope("/i/history/")).toEqual({ kind: "history" });
    expect(resolveScope("/i/history/likes")).toEqual({ kind: "history" });
    expect(resolveScope("/i/history/videos")).toEqual({ kind: "history" });
    expect(resolveScope("/i/history/articles")).toEqual({ kind: "history" });
    expect(resolveScope("/i/history/123")).toEqual({ kind: "history" });
  });

  it("resolves a profile by handle, case-folded so @Jack and @jack are one scope", () => {
    expect(resolveScope("/jack")).toEqual({ kind: "profile", handle: "jack" });
    expect(resolveScope("/Jack")).toEqual({ kind: "profile", handle: "jack" });
    expect(resolveScope("/jack/")).toEqual({ kind: "profile", handle: "jack" });
    expect(resolveScope("/mhdhh_archives")).toEqual({ kind: "profile", handle: "mhdhh_archives" });
  });

  it("resolves a profile's post sub-tabs to the same scope as the bare profile", () => {
    for (const tab of ["with_replies", "media", "likes", "highlights"]) {
      expect(resolveScope(`/jack/${tab}`)).toEqual({ kind: "profile", handle: "jack" });
    }
  });

  /**
   * A reserved root must never resolve to a profile — the handle is folded
   * before the reserved-root lookup, so a case-varied nav route (`/Explore`)
   * has to be rejected just as firmly as the lowercase one. `/Home` is the
   * sharpest case: it misses the exact `/home` check, then must be caught as a
   * reserved root rather than falling through to a profile named "Home".
   */
  it("resolves reserved top-level routes to no scope, whatever their case", () => {
    for (const path of [
      "/explore",
      "/search",
      "/notifications",
      "/messages",
      "/messages/123",
      "/settings/profile",
      "/hashtag/foo",
      "/bookmarks", // legacy top-level, not the /i/bookmarks timeline
      "/history", // legacy top-level, not the /i/history timeline
      "/i/lists", // no list id
      "/Explore",
      "/Home",
      "/Bookmarks",
      "/History",
    ]) {
      expect(resolveScope(path)).toBeNull();
    }
  });

  it("resolves out-of-scope paths to no scope", () => {
    expect(resolveScope("/i/bookmarks/abc")).toBeNull();
    expect(resolveScope("/i/bookmarks/123/extra")).toBeNull();
    expect(resolveScope("/i/history/abc")).toBeNull(); // not a known tab or a folder id
    expect(resolveScope("/i/history/likes/extra")).toBeNull();
    expect(resolveScope("/jack/status/123")).toBeNull();
    expect(resolveScope("/jack/photo")).toBeNull();
    expect(resolveScope("/")).toBeNull();
    expect(resolveScope("")).toBeNull();
    expect(resolveScope("/this_handle_is_way_too_long")).toBeNull();
    expect(resolveScope("/has-a-dash")).toBeNull();
  });
});

/**
 * This table is the behavior-neutrality guard for the resolver prefactor: the
 * boolean is now derived from resolveScope, and every case below must still
 * answer exactly as it did before.
 */
describe("isInScope", () => {
  it("is in scope on Home and List timelines", () => {
    expect(isInScope("/home")).toBe(true);
    expect(isInScope("/i/lists/123")).toBe(true);
    expect(isInScope("/i/lists/123/members")).toBe(true);
  });

  it("is in scope on the Bookmarks timeline and its folders", () => {
    expect(isInScope("/i/bookmarks")).toBe(true); // All Bookmarks timeline
    expect(isInScope("/i/bookmarks/")).toBe(true); // trailing slash
    expect(isInScope("/i/bookmarks/1234567890123456789")).toBe(true); // numeric folder
    expect(isInScope("/i/bookmarks/123/")).toBe(true); // folder, trailing slash
  });

  it("is in scope on the History hub and its tabs", () => {
    expect(isInScope("/i/history")).toBe(true); // Bookmarks tab (the default)
    expect(isInScope("/i/history/")).toBe(true); // trailing slash
    expect(isInScope("/i/history/likes")).toBe(true);
    expect(isInScope("/i/history/videos")).toBe(true);
    expect(isInScope("/i/history/articles")).toBe(true);
    expect(isInScope("/i/history/1234567890123456789")).toBe(true); // numeric folder
  });

  it("is in scope on a profile and its post sub-tabs", () => {
    expect(isInScope("/jack")).toBe(true);
    expect(isInScope("/mhdhh_archives")).toBe(true);
    expect(isInScope("/Jack")).toBe(true); // handles are case-insensitive
    expect(isInScope("/jack/")).toBe(true); // trailing slash
    expect(isInScope("/jack/with_replies")).toBe(true);
    expect(isInScope("/jack/media")).toBe(true);
    expect(isInScope("/jack/likes")).toBe(true);
    expect(isInScope("/jack/highlights")).toBe(true);
  });

  it("is out of scope on reserved top-level routes", () => {
    expect(isInScope("/explore")).toBe(false);
    expect(isInScope("/search")).toBe(false);
    expect(isInScope("/i/lists")).toBe(false);
    expect(isInScope("/notifications")).toBe(false);
    expect(isInScope("/messages")).toBe(false);
    expect(isInScope("/messages/123")).toBe(false);
    expect(isInScope("/settings/profile")).toBe(false);
    expect(isInScope("/hashtag/foo")).toBe(false);
    expect(isInScope("/bookmarks")).toBe(false); // legacy top-level, not a timeline route
    expect(isInScope("/history")).toBe(false); // legacy top-level, not the /i/history route
  });

  it("is out of scope on bookmarks sub-paths that aren't a folder timeline", () => {
    expect(isInScope("/i/bookmarks/all")).toBe(false); // non-numeric slug is not a folder
    expect(isInScope("/i/bookmarks/abc")).toBe(false);
    expect(isInScope("/i/bookmarks/123/extra")).toBe(false); // deeper than a folder
  });

  it("is out of scope on history sub-paths that aren't a known tab or a folder", () => {
    expect(isInScope("/i/history/abc")).toBe(false); // unknown tab slug
    expect(isInScope("/i/history/likes/extra")).toBe(false); // deeper than a tab
  });

  it("is out of scope on profile pages that aren't timelines", () => {
    expect(isInScope("/jack/status/123")).toBe(false); // single post
    expect(isInScope("/jack/photo")).toBe(false); // avatar lightbox
    expect(isInScope("/jack/header_photo")).toBe(false);
  });

  it("is out of scope on the root and malformed handles", () => {
    expect(isInScope("/")).toBe(false);
    expect(isInScope("")).toBe(false);
    expect(isInScope("/this_handle_is_way_too_long")).toBe(false); // > 15 chars
    expect(isInScope("/has-a-dash")).toBe(false); // invalid handle char
  });
});

/**
 * x.com is a SPA, so the Filter re-evaluates on history navigations rather than
 * page loads. `onRouteChange` patches history.pushState/replaceState once (shared
 * across subscribers) and also listens for popstate; the returned unsubscribe
 * drops just that listener.
 */
describe("onRouteChange", () => {
  it("fires on pushState, replaceState, and popstate, and stops after unsubscribe", () => {
    const cb = vi.fn();
    const off = onRouteChange(cb);

    history.pushState({}, "", "/home");
    expect(cb).toHaveBeenCalledTimes(1);

    history.replaceState({}, "", "/explore");
    expect(cb).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(cb).toHaveBeenCalledTimes(3);

    off();
    history.pushState({}, "", "/jack");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(cb).toHaveBeenCalledTimes(3); // no further calls after unsubscribe
  });

  it("shares the one history patch across multiple subscribers (idempotent patch)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onRouteChange(a); // history is already patched from the prior test
    const offB = onRouteChange(b);

    history.pushState({}, "", "/notifications");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    offB();
  });
});
