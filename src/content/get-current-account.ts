import { Selectors } from "@/content/selectors";
import type { Owner } from "@/core/membership-store/types";

export interface CurrentAccountDeps {
  /** Defaults to document.cookie. */
  cookie?: string;
  /** Best-effort current handle href ("/jane"); defaults to reading the profile link. */
  profileHref?: () => string | null;
}

/**
 * The logged-in Owner, read at action time (ADR-0009). `userId` comes from the
 * `twid` cookie — verified readable from `document.cookie` on x.com 2026-06-13
 * (NOT HttpOnly), raw `twid=u%3D<id>`. `screenName` is best-effort from the
 * profile-link href and may be "" before hydration. Returns null when not logged
 * in (no twid), so callers skip the Mirror rather than mis-attributing a record.
 */
export function getCurrentAccount(deps: CurrentAccountDeps = {}): Owner | null {
  const cookie = deps.cookie ?? (typeof document !== "undefined" ? document.cookie : "");
  const userId = parseTwid(cookie);
  if (userId === null) return null;
  const href = deps.profileHref ? deps.profileHref() : readProfileHref();
  return { userId, screenName: handleFromHref(href) };
}

/** Extract the numeric userId from the `twid` cookie (`u=<id>`, URL-encoded). */
function parseTwid(cookie: string): string | null {
  const m = cookie.match(/(?:^|;\s*)twid=([^;]+)/);
  if (!m) return null;
  const idMatch = decodeURIComponent(m[1] as string).match(/u=(\d+)/);
  return idMatch ? (idMatch[1] as string) : null;
}

function readProfileHref(): string | null {
  if (typeof document === "undefined") return null;
  return (
    document.querySelector(Selectors.CURRENT_USER_PROFILE_LINK)?.getAttribute("href") ?? null
  );
}

/** "/jane_doe" -> "jane_doe"; null/empty -> "". */
function handleFromHref(href: string | null): string {
  if (!href) return "";
  return href.replace(/^\//, "").split(/[/?#]/)[0] ?? "";
}
