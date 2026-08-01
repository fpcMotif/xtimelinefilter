import type { PostCapture } from "@/packages/folders/types";

export type SocialPlatform = "threads" | "instagram";
export type CursorDirection = "next" | "previous";

export interface SocialPost {
  readonly key: string;
  readonly root: Element;
  readonly permalink: string;
}

export interface SocialPostAdapter {
  readonly platform: SocialPlatform;
  posts(doc?: Document): SocialPost[];
  rootForTarget(target: EventTarget | null, doc?: Document): Element | null;
  capture(root: Element): PostCapture;
  identity(root: Element): string | null;
}

export interface TimelineCursor {
  current(): Element | null;
  move(direction: CursorDirection): Element | null;
  observePointer(target: EventTarget | null): Element | null;
  release(root: Element): void;
}

const HOSTS: Record<SocialPlatform, readonly string[]> = {
  threads: ["threads.com", "www.threads.com", "threads.net", "www.threads.net"],
  instagram: ["instagram.com", "www.instagram.com"],
};

const LINK_SELECTORS: Record<SocialPlatform, string> = {
  threads: 'a[href*="/post/"]',
  instagram: 'a[href*="/p/"], a[href*="/reel/"]',
};

const ID_PATTERNS: Record<SocialPlatform, RegExp> = {
  threads: /^\/@([^/]+)\/post\/([^/?#]+)/,
  instagram: /^\/(?:p|reel)\/([^/?#]+)/,
};

const isElement = (value: EventTarget | null): value is Element => value instanceof Element;

export function socialPlatformForHost(host: string): SocialPlatform | null {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  for (const platform of ["threads", "instagram"] as const) {
    if (HOSTS[platform].includes(normalized)) return platform;
  }
  return null;
}

function sameOriginUrl(platform: SocialPlatform, href: string): URL | null {
  try {
    const url = new URL(href, `https://${HOSTS[platform][0]}`);
    if (!HOSTS[platform].includes(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

function postId(platform: SocialPlatform, href: string): { id: string; permalink: string } | null {
  const url = sameOriginUrl(platform, href);
  if (!url) return null;
  const match = ID_PATTERNS[platform].exec(url.pathname);
  if (!match) return null;
  const id = platform === "threads" ? match[2]! : match[1]!;
  const permalink =
    platform === "threads"
      ? `https://www.threads.com${url.pathname}`
      : `https://www.instagram.com${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
  return { id, permalink };
}

function postLinks(root: Element, platform: SocialPlatform): HTMLAnchorElement[] {
  return [...root.querySelectorAll<HTMLAnchorElement>(LINK_SELECTORS[platform])].filter((link) =>
    postId(platform, link.getAttribute("href") ?? link.href),
  );
}

function textLength(root: Element): number {
  return (
    "innerText" in root ? String((root as HTMLElement).innerText) : (root.textContent ?? "")
  ).trim().length;
}

/**
 * Meta's post wrappers have no stable semantic class. The first ancestor that
 * contains a meaningful post body (rather than only the timestamp link) is the
 * smallest useful post cell. This deliberately avoids hashed class names.
 */
function findPostRoot(link: HTMLAnchorElement, platform: SocialPlatform): Element | null {
  let candidate = link.parentElement;
  let best: Element | null = null;
  while (candidate && candidate !== candidate.ownerDocument.body) {
    const count = postLinks(candidate, platform).length;
    const parentCount = candidate.parentElement
      ? postLinks(candidate.parentElement, platform).length
      : 0;
    const hasBody =
      candidate.getBoundingClientRect().height >= 40 ||
      textLength(candidate) >= 32 ||
      (count > 0 && parentCount > count);
    if (count > 0 && hasBody) {
      best = candidate;
      if (parentCount > count) return candidate;
    }
    candidate = candidate.parentElement;
  }
  return best ?? link.parentElement ?? link;
}

function visible(root: Element): boolean {
  if (root.hasAttribute("hidden") || root.getAttribute("aria-hidden") === "true") return false;
  const view = root.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(root);
  return style.display !== "none" && style.visibility !== "hidden";
}

function rootEntry(link: HTMLAnchorElement, platform: SocialPlatform): SocialPost | null {
  const parsed = postId(platform, link.getAttribute("href") ?? link.href);
  if (!parsed) return null;
  const root = findPostRoot(link, platform);
  return root ? { key: `${platform}:${parsed.id}`, root, permalink: parsed.permalink } : null;
}

function uniquePosts(doc: Document, platform: SocialPlatform): SocialPost[] {
  const entries = [...doc.querySelectorAll<HTMLAnchorElement>(LINK_SELECTORS[platform])]
    .map((link) => rootEntry(link, platform))
    .filter((entry): entry is SocialPost => entry !== null && visible(entry.root));
  const byRoot = new Map<Element, SocialPost>();
  for (const entry of entries) if (!byRoot.has(entry.root)) byRoot.set(entry.root, entry);
  const roots = [...byRoot.keys()];
  return roots
    .filter((root) => !roots.some((other) => other !== root && other.contains(root)))
    .map((root) => byRoot.get(root)!)
    .filter(Boolean);
}

function parsedForRoot(
  root: Element,
  platform: SocialPlatform,
): { id: string; permalink: string } | null {
  const link = postLinks(root, platform)[0];
  return link ? postId(platform, link.getAttribute("href") ?? link.href) : null;
}

function captureText(root: Element): string | undefined {
  const clone = root.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll("time, button, svg, [aria-hidden='true']")) {
    node.remove();
  }
  const value = (
    "innerText" in clone ? String((clone as HTMLElement).innerText) : (clone.textContent ?? "")
  )
    .replace(/\s+/g, " ")
    .trim();
  return value || undefined;
}

function captureAuthor(
  root: Element,
  platform: SocialPlatform,
): { screenName: string } | undefined {
  const link = postLinks(root, platform)[0];
  if (!link) return undefined;
  const parsed = postId(platform, link.getAttribute("href") ?? link.href);
  if (!parsed) return undefined;
  const path = new URL(parsed.permalink).pathname;
  const match = ID_PATTERNS[platform].exec(path);
  return platform === "threads" && match?.[1] && match[1].length <= 20
    ? { screenName: match[1] }
    : undefined;
}

function captureMedia(root: Element): PostCapture["media"] {
  const media: PostCapture["media"] = [];
  for (const video of root.querySelectorAll<HTMLVideoElement>("video")) {
    const url =
      video.getAttribute("poster") ||
      video.poster ||
      video.currentSrc ||
      video.getAttribute("src") ||
      undefined;
    media.push(url ? { kind: "video", url } : { kind: "video" });
  }
  for (const image of root.querySelectorAll<HTMLImageElement>("img[src]")) {
    if (image.closest("video")) continue;
    media.push({ kind: "photo", url: image.src });
  }
  return media.slice(0, 8);
}

function capturePostedAt(root: Element): string | undefined {
  const raw = root.querySelector("time[datetime]")?.getAttribute("datetime");
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function createSocialPostAdapter(platform: SocialPlatform): SocialPostAdapter {
  return {
    platform,
    posts(doc = document) {
      return uniquePosts(doc, platform);
    },
    rootForTarget(target, doc = document) {
      if (!isElement(target)) return null;
      const candidates = uniquePosts(doc, platform);
      const matches = candidates.filter((candidate) => candidate.root.contains(target));
      // oxlint-disable-next-line unicorn/no-array-sort -- fresh array; Chrome 106 lacks toSorted().
      matches.sort((left, right) => textLength(left.root) - textLength(right.root));
      return matches[0]?.root ?? null;
    },
    identity(root) {
      const parsed = parsedForRoot(root, platform);
      return parsed ? `${platform}:${parsed.id}` : null;
    },
    capture(root) {
      const parsed = parsedForRoot(root, platform);
      const statusId = parsed ? `${platform}:${parsed.id}` : null;
      const author = parsed ? captureAuthor(root, platform) : undefined;
      const text = captureText(root);
      const postedAt = capturePostedAt(root);
      return {
        statusId,
        permalink: parsed?.permalink ?? null,
        ...(author ? { author } : {}),
        ...(text ? { text } : {}),
        media: captureMedia(root),
        ...(postedAt ? { postedAt } : {}),
      };
    },
  };
}

function clearCursorMarker(root: Element | null): void {
  root?.removeAttribute("data-lasso-cursor");
}

function focusCursorRoot(root: Element): void {
  const el = root as HTMLElement;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus?.({ preventScroll: true });
  el.scrollIntoView?.({ block: "nearest" });
}

export function createTimelineCursor(
  adapter: SocialPostAdapter,
  doc: Document = document,
): TimelineCursor {
  let currentKey: string | null = null;
  let currentRoot: Element | null = null;

  const mark = (root: Element): void => {
    clearCursorMarker(currentRoot);
    root.setAttribute("data-lasso-cursor", "true");
    currentRoot = root;
    currentKey = adapter.identity(root);
  };

  const candidates = (): SocialPost[] => adapter.posts(doc);

  return {
    current() {
      const all = candidates();
      if (currentKey) {
        const refreshed = all.find((post) => post.key === currentKey);
        if (refreshed) {
          if (currentRoot !== refreshed.root) {
            clearCursorMarker(currentRoot);
            refreshed.root.setAttribute("data-lasso-cursor", "true");
          }
          currentRoot = refreshed.root;
          return refreshed.root;
        }
      }
      clearCursorMarker(currentRoot);
      currentRoot = null;
      currentKey = null;
      return null;
    },
    move(direction) {
      const all = candidates();
      if (all.length === 0) return null;
      const index = currentKey ? all.findIndex((post) => post.key === currentKey) : -1;
      const nextIndex =
        index < 0
          ? direction === "next"
            ? 0
            : all.length - 1
          : Math.max(0, Math.min(index + (direction === "next" ? 1 : -1), all.length - 1));
      const next = all[nextIndex]!;
      mark(next.root);
      focusCursorRoot(next.root);
      return next.root;
    },
    observePointer(target) {
      const root = adapter.rootForTarget(target, doc);
      if (!root) return null;
      mark(root);
      return root;
    },
    release(root) {
      if (currentRoot !== root) return;
      clearCursorMarker(root);
      currentRoot = null;
      currentKey = null;
    },
  };
}
