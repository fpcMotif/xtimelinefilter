import { describe, expect, it, vi } from "vitest";

import { isInScope, onRouteChange } from "@/content/route";

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
  });

  it("is out of scope on bookmarks sub-paths that aren't a folder timeline", () => {
    expect(isInScope("/i/bookmarks/all")).toBe(false); // non-numeric slug is not a folder
    expect(isInScope("/i/bookmarks/abc")).toBe(false);
    expect(isInScope("/i/bookmarks/123/extra")).toBe(false); // deeper than a folder
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
