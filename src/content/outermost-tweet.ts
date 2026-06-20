import { Selectors } from "@/content/selectors";

/**
 * The outermost tweet article enclosing `el`. Quoted tweets nest <article>s, and
 * the outermost one owns the caret and author — so quick-action targeting climbs
 * to it. Returns `el` itself when nothing tweet-shaped encloses it, or null when
 * `el` is null (the pointer was over no tweet).
 */
export function outermostTweet(el: Element | null): Element | null {
  let t = el;
  while (t) {
    const outer = t.parentElement?.closest(Selectors.TWEET);
    if (!outer) break;
    t = outer;
  }
  return t;
}
