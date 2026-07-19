import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Focus a transient surface without moving the underlying page. Older DOM
    shims do not accept FocusOptions, so retain the plain-focus fallback. */
export function focusWithoutScroll(element: HTMLElement | null): void {
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

/** Keep a selected row visible by moving only its own scroll container. This
    avoids Element.scrollIntoView(), which can also move X's page. */
export function scrollIntoViewWithin(
  container: HTMLElement | null,
  target: HTMLElement | null,
): void {
  if (!container || !target) return;
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  if (targetRect.top < containerRect.top) container.scrollTop -= containerRect.top - targetRect.top;
  else if (targetRect.bottom > containerRect.bottom)
    container.scrollTop += targetRect.bottom - containerRect.bottom;
}

/** Focus as seen from the container's tree — inside an open Shadow DOM,
    `document.activeElement` is the shadow *host*, never the inner element. */
function activeElementOf(container: HTMLElement): Element | null {
  return (container.getRootNode() as Document | ShadowRoot).activeElement;
}

function previouslyFocusedElement(container: HTMLElement): HTMLElement | null {
  const root = container.getRootNode();
  // An in-page Lasso dialog lives in a Shadow DOM. Its host is the document's
  // active element only while focus is inside that tree; otherwise the real
  // prior target is document.activeElement.
  if (root instanceof ShadowRoot && document.activeElement === root.host) {
    return root.activeElement as HTMLElement | null;
  }
  return document.activeElement as HTMLElement | null;
}

/**
 * Focus trap for the two true modals (WelcomeCard, ShortcutsSheet). On mount,
 * moves focus into the dialog (fallback: the container itself); while mounted,
 * traps Tab/Shift+Tab within the dialog's focusable elements (wrap-around); on
 * unmount, restores focus to whatever had it before. The keydown listener lives
 * on the container itself rather than `document` — the in-page UI mounts inside
 * an open Shadow DOM, and a container-level listener works across that boundary
 * without depending on event retargeting.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = previouslyFocusedElement(container);

    const first = focusableElements(container)[0];
    if (first) {
      focusWithoutScroll(first);
    } else {
      container.tabIndex = -1;
      focusWithoutScroll(container);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusableElements(container!);
      if (items.length === 0) {
        e.preventDefault();
        focusWithoutScroll(container!);
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const focused = activeElementOf(container!);
      if (e.shiftKey && (focused === firstItem || !container!.contains(focused))) {
        e.preventDefault();
        focusWithoutScroll(lastItem);
      } else if (!e.shiftKey && (focused === lastItem || !container!.contains(focused))) {
        e.preventDefault();
        focusWithoutScroll(firstItem);
      }
    }

    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) focusWithoutScroll(previouslyFocused);
    };
  }, [containerRef, active]);
}
