import { AVATAR_CONTAINER_PREFIX, Selectors } from "@/content/selectors";

/**
 * The DOM-reading primitives every read in this package shares. Host scoping is
 * the important one: a quoted post is itself an `article[data-testid="tweet"]`,
 * so a match only counts when its NEAREST enclosing tweet article is the one
 * being read — otherwise document order decides whose data wins.
 */

/** True when `el`'s nearest enclosing tweet article is `article` itself. */
export function isHostOwn(el: Element, article: Element): boolean {
  return el.closest(Selectors.TWEET) === article;
}

/** The article's own first match for `selector`, ignoring nested posts'. */
export function hostOwn(article: Element, selector: string): Element | undefined {
  return [...article.querySelectorAll(selector)].find((el) => isHostOwn(el, article));
}

/** Reads visible text, expanding emoji <img alt> and ignoring badge <svg> text. */
export function readVisibleText(node: Node): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += (n as Text).data;
    else if (n.nodeName === "IMG") out += (n as HTMLImageElement).alt;
    else if (n.nodeType === 1) out += readVisibleText(n);
  });
  return out;
}

/** Visible text, whitespace-collapsed; undefined when nothing legible is left. */
export function readCollapsedText(node: Node): string | undefined {
  const raw = readVisibleText(node).replace(/\s+/g, " ").trim();
  return raw || undefined;
}

/** The handle X encodes in an avatar container's testid suffix. */
export function handleFromAvatarContainer(el: Element | null | undefined): string | undefined {
  const tid = el?.getAttribute("data-testid");
  return tid?.startsWith(AVATAR_CONTAINER_PREFIX)
    ? tid.slice(AVATAR_CONTAINER_PREFIX.length)
    : undefined;
}
