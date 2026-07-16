/**
 * Live-overlay disposer registry: each pruned cell's disposer runs on removal,
 * so the map — and the signal subscriber lists behind it — stay bounded by the
 * visible timeline instead of growing with every scrolled-past post.
 */
export interface OverlayLifecycle {
  /** Mounts `article` via `mount()`; a null result (already mounted) is a no-op. */
  attach(article: Element, mount: () => (() => void) | null): void;
  /** Runs and forgets the disposer for a pruned article (harmless if absent). */
  releaseFor(article: Element): void;
  /** Runs every live disposer and clears the registry. */
  disposeAll(): void;
}

export function createOverlayLifecycle(): OverlayLifecycle {
  const disposers = new Map<Element, () => void>();

  return {
    attach(article, mount) {
      const dispose = mount();
      if (dispose) disposers.set(article, dispose);
    },
    releaseFor(article) {
      disposers.get(article)?.();
      disposers.delete(article);
    },
    disposeAll() {
      for (const dispose of disposers.values()) dispose();
      disposers.clear();
    },
  };
}
