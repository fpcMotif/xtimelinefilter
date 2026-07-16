import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/** Focus as seen from the container's tree — inside an open Shadow DOM,
    `document.activeElement` is the shadow *host*, never the inner element. */
function activeElementOf(container: HTMLElement): Element | null {
  return (container.getRootNode() as Document | ShadowRoot).activeElement;
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
export function useFocusTrap(containerRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = activeElementOf(container) as HTMLElement | null;

    const first = focusableElements(container)[0];
    if (first) {
      first.focus();
    } else {
      container.tabIndex = -1;
      container.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusableElements(container!);
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = activeElementOf(container!);
      if (e.shiftKey && active === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [containerRef]);
}
