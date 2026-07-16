/**
 * Quick actions target the tweet under the mouse (fallback: X's native j/k
 * focus), so Alt+m / Alt+n work without pressing j first. `onHover` mirrors the
 * pointer precisely (drives overlay fade-in); the internal sticky target stays
 * put once set, so it survives the mouse drifting off the post, and only clears
 * via `release()` when the caller learns the article left the DOM.
 */
export interface HoverTrackerDeps {
  /** Resolves a raw event target to the tweet article it belongs to (or null). */
  resolve: (el: Element | null) => Element | null;
  /** Called on every capture-phase mousemove with the resolved article (or null). */
  onHover: (article: Element | null) => void;
  /** X's native cursor target, used when nothing has been hovered yet. */
  fallback: () => Element | null;
  doc?: Document;
}

export interface HoverTracker {
  /** The sticky hover target if still attached, else the native-cursor fallback. */
  targetTweet(): Element | null;
  /** Forgets `article` as the sticky target (call when it leaves the DOM). */
  release(article: Element): void;
  dispose(): void;
}

export function installHoverTracker(deps: HoverTrackerDeps): HoverTracker {
  const doc = deps.doc ?? document;
  let hoveredSticky: Element | null = null;

  const handler = (e: MouseEvent): void => {
    const t = deps.resolve((e.target as Element | null) ?? null);
    if (t) hoveredSticky = t;
    deps.onHover(t);
  };
  doc.addEventListener("mousemove", handler, { capture: true, passive: true });

  return {
    targetTweet: () =>
      hoveredSticky && doc.contains(hoveredSticky) ? hoveredSticky : deps.fallback(),
    release(article) {
      if (hoveredSticky === article) hoveredSticky = null;
    },
    dispose() {
      doc.removeEventListener("mousemove", handler, true);
    },
  };
}
