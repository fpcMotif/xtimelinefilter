import { type Credentials, XApiError } from "./types";

/**
 * Seed value only — the public web bearer rotates. The GraphQL backend may
 * refresh it by sniffing the live bundle (MAIN world). See ADR-0004 / blueprint §8.
 */
export const PUBLIC_WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export interface Auth {
  credentials(): Credentials;
}

export interface DocumentAuthOptions {
  /** Override the bearer; defaults to {@link PUBLIC_WEB_BEARER}. */
  bearer?: string;
  /** Cookie source; defaults to reading `document.cookie` (same-origin x.com). */
  getCookie?: () => string;
}

/**
 * Supplies credentials from the logged-in x.com page context. ct0 is read from
 * document.cookie (it is intentionally not HttpOnly — double-submit CSRF). The
 * HttpOnly auth_token is never read; the browser attaches it on same-origin fetch.
 */
export function createDocumentAuth(opts: DocumentAuthOptions = {}): Auth {
  const getCookie = opts.getCookie ?? (() => document.cookie);
  const bearer = opts.bearer ?? PUBLIC_WEB_BEARER;
  return {
    credentials(): Credentials {
      const csrf = readCookie("ct0", getCookie());
      if (!csrf) throw new XApiError("auth", "Missing ct0 cookie — log in to X first.");
      return { csrf, bearer };
    },
  };
}

function readCookie(name: string, jar: string): string | null {
  for (const part of jar.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq);
    if (key === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}
