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

export interface TweetScannerOptions {
  /** Per observer batch: how many mutations fired and how many posts matched (health). */
  onScan?: (mutations: number, matches: number) => void;
}

/**
 * Observes a root for tweet articles (virtualized timeline mounts/unmounts them),
 * de-dupes by node, extracts the author, and reports each new tweet once.
 * Pure of UI concerns so it is testable in happy-dom.
 */
export function createTweetScanner(
  root: Document | Element,
  onTweet: (author: TweetAuthor, article: Element) => void,
  opts: TweetScannerOptions = {},
): TweetScanner {
  const seen = new WeakSet<Element>();

  const handle = (article: Element): void => {
    if (seen.has(article)) return;
    seen.add(article);
    const author = extractAuthor(article);
    if (author) onTweet(author, article);
  };

  const scanExisting = (): void => {
    const found = root.querySelectorAll(Selectors.TWEET);
    for (const el of found) handle(el);
    opts.onScan?.(0, found.length);
  };

  const observer = new MutationObserver((mutations) => {
    let matches = 0;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(Selectors.TWEET)) {
          matches++;
          handle(node);
        }
        for (const el of node.querySelectorAll(Selectors.TWEET)) {
          matches++;
          handle(el);
        }
      }
    }
    opts.onScan?.(mutations.length, matches);
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
