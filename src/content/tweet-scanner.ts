import { Selectors } from "@/content/selectors";

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
  /**
   * A previously-reported article left the DOM (X's virtualization pruned the
   * cell). The article is forgotten, so if X re-adds the same node it is reported
   * again. Callers use this to dispose per-post resources (overlay Preact trees,
   * signal subscriptions) — without it those leak for every scrolled-past post.
   */
  onTweetRemoved?: (article: Element) => void;
}

/**
 * Observes a root for tweet articles (virtualized timeline mounts/unmounts them),
 * de-dupes by node and reports each mounted Tweet once.
 * Pure of UI concerns so it is testable in happy-dom.
 */
export function createTweetScanner(
  root: Document | Element,
  onTweet: (article: Element) => void,
  opts: TweetScannerOptions = {},
): TweetScanner {
  const seen = new WeakSet<Element>();

  const handle = (article: Element): void => {
    if (seen.has(article)) return;
    seen.add(article);
    onTweet(article);
  };

  const scanExisting = (): void => {
    const found = root.querySelectorAll(Selectors.TWEET);
    for (const el of found) handle(el);
    opts.onScan?.(0, found.length);
  };

  const handleRemoved = (article: Element): void => {
    if (!seen.has(article)) return;
    // Reparent-in-one-batch guard: mutation callbacks run after the batch settled,
    // so a node that is back in the document was moved, not pruned — keep it.
    if (root.contains(article)) return;
    seen.delete(article);
    opts.onTweetRemoved?.(article);
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
      for (const node of m.removedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(Selectors.TWEET)) handleRemoved(node);
        for (const el of node.querySelectorAll(Selectors.TWEET)) handleRemoved(el);
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
