import { SYNTHETIC_EVENT_FLAG } from "@/content/selectors";

/**
 * Select mode: clicking anywhere on a post's body toggles it — sweeping a
 * thread is one click per post, no aiming at 22px circles (story beat 7).
 * `onToggle` returning `false` means "nothing to toggle" — the layer leaves the
 * click alone (same convention as keyboard.ts's `run`), otherwise the native
 * click is suppressed so it can't also trigger X's own handlers.
 */
export interface SelectTapDeps {
  /** False while select mode is off — the layer is inert then. */
  isActive: () => boolean;
  /** Resolves the click's origin to the tweet article it should toggle (or null). */
  resolveTarget: (eventTarget: EventTarget | null) => Element | null;
  /** Returning `false` leaves the event untouched (nothing was toggled). */
  onToggle: (article: Element) => boolean | void;
  doc?: Document;
}

export function installSelectTap(deps: SelectTapDeps): () => void {
  const doc = deps.doc ?? document;

  const handler = (e: MouseEvent): void => {
    // Only UA-dispatched primary clicks are user intent. Page scripts and
    // Lasso's own drivers must not toggle selection or be suppressed here.
    if (!e.isTrusted) return;
    if ((e as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) return;
    if (e.button !== 0) return;
    if (!deps.isActive()) return;
    const origin = e.composedPath?.()[0] ?? e.target;
    const article = deps.resolveTarget(origin);
    if (!article) return;
    if (deps.onToggle(article) === false) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  doc.addEventListener("click", handler, { capture: true });
  return () => doc.removeEventListener("click", handler, true);
}
