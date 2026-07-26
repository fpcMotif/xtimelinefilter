import { computed, type Signal } from "@preact/signals-core";
import { render } from "preact";

import { OverlayBinding } from "@/content/app";
import type { LassoController } from "@/content/controller";
import type { HighContrastHosts } from "@/content/high-contrast-hosts";
import { Selectors } from "@/content/selectors";
import type { Coach } from "@/core/coach";
import type { SelectionStore, TweetAuthor } from "@/core/selection-store";
import { attachShadowRoot } from "@/ui/mount";

export const TWEET_OVERLAY_ATTRIBUTE = "data-lasso-overlay";

export interface TweetOverlayMountDeps {
  selection: SelectionStore;
  controller: Pick<LassoController, "toggleSelect">;
  coach: Coach;
  visualHover: Signal<Element | null>;
  highContrastHosts: HighContrastHosts;
}

/**
 * Mounts one avatar overlay and owns its DOM, Preact, theme, and rollback
 * lifecycle. Returning null means this article already owns an overlay.
 */
export function mountTweetOverlay(
  article: Element,
  author: TweetAuthor,
  deps: TweetOverlayMountDeps,
): (() => void) | null {
  const avatar = article.querySelector<HTMLElement>(Selectors.AVATAR_CONTAINER);
  const anchor = avatar ?? article.querySelector('[data-testid="User-Name"]') ?? article;
  if (anchor.querySelector(`[${TWEET_OVERLAY_ATTRIBUTE}]`)) return null;

  const host = document.createElement("span");
  host.setAttribute(TWEET_OVERLAY_ATTRIBUTE, "");
  const previousPosition = avatar?.style.position;
  let positionedAvatar = false;
  if (avatar) {
    if (getComputedStyle(avatar).position === "static") {
      avatar.style.position = "relative";
      positionedAvatar = true;
    }
    host.style.cssText = "position:absolute;right:-4px;bottom:-4px;z-index:10;display:block";
    avatar.appendChild(host);
  } else {
    host.style.cssText = "display:inline-flex;vertical-align:middle;margin-inline-end:6px";
    anchor.prepend(host);
  }

  let unregisterHost: (() => void) | undefined;
  let mount: Element | undefined;
  try {
    const hovered = computed(() => deps.visualHover.value === article);
    unregisterHost = deps.highContrastHosts.register(host);
    mount = attachShadowRoot(host).mount;
    render(
      <OverlayBinding
        selection={deps.selection}
        author={author}
        hovered={hovered}
        coach={deps.coach}
        onToggle={() => deps.controller.toggleSelect(author)}
      />,
      mount,
    );
  } catch (error) {
    unregisterHost?.();
    host.remove();
    /* v8 ignore next -- previousPosition is always a string when positionedAvatar is true. */
    if (positionedAvatar && avatar) avatar.style.position = previousPosition ?? "";
    throw error;
  }

  return () => {
    render(null, mount!);
    unregisterHost?.();
    host.remove();
    /* v8 ignore next -- previousPosition is always a string when positionedAvatar is true. */
    if (positionedAvatar && avatar) avatar.style.position = previousPosition ?? "";
  };
}
