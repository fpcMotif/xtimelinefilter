import { Selectors } from "@/content/selectors";
import type { TweetAuthor } from "@/core/selection-store";
import { extractAuthor } from "@/core/tweet-extractor";

export interface TweetScanner {
  /** Process tweets already in the DOM and start observing for new ones. */
  start(): void;
  stop(): void;
  /** Process tweets currently in the DOM (idempotent via the dedupe set). */
  scanExisting(): void;
}

/**
 * Observes a root for tweet articles (virtualized timeline mounts/unmounts them),
 * de-dupes by node, extracts the author, and reports each new tweet once.
 * Pure of UI concerns so it is testable in happy-dom.
 */
export function createTweetScanner(
  root: Document | Element,
  onTweet: (author: TweetAuthor, article: Element) => void,
): TweetScanner {
  const seen = new WeakSet<Element>();

  const handle = (article: Element): void => {
    if (seen.has(article)) return;
    seen.add(article);
    const author = extractAuthor(article);
    if (author) onTweet(author, article);
  };

  const scanExisting = (): void => {
    for (const el of root.querySelectorAll(Selectors.TWEET)) handle(el);
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(Selectors.TWEET)) handle(node);
        for (const el of node.querySelectorAll(Selectors.TWEET)) handle(el);
      }
    }
  });

  return {
    start() {
      scanExisting();
      const target = root.nodeType === Node.DOCUMENT_NODE ? (root as Document).body : root;
      observer.observe(target, { childList: true, subtree: true });
    },
    stop() {
      observer.disconnect();
    },
    scanExisting,
  };
}
