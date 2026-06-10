import { Selectors } from "@/content/selectors";

/**
 * Resolves the tweet article X's native j/k cursor currently points at, using the
 * verified read recipe (docs/research/07): aria-activedescendant → getElementById
 * → closest(article), then document.activeElement, then :focus-within. Never cache
 * the node — the timeline is virtualized; re-query every keypress.
 */
export function getFocusedTweet(doc: Document = document): Element | null {
  const activeId = doc
    .querySelector("[aria-activedescendant]")
    ?.getAttribute("aria-activedescendant");
  if (activeId) {
    const node = doc.getElementById(activeId);
    const tweet = node?.closest(Selectors.TWEET) ?? node?.querySelector(Selectors.TWEET) ?? null;
    if (tweet) return tweet;
  }

  const fromActive = doc.activeElement?.closest(Selectors.TWEET);
  if (fromActive) return fromActive;

  return doc.querySelector(`${Selectors.TWEET}:focus-within`);
}
