import { type Credentials, XApiError } from "./types";

/** Session auth headers for same-origin x.com calls: web bearer + ct0 csrf. */
export function authHeaders(creds: Credentials): Record<string, string> {
  return {
    authorization: `Bearer ${creds.bearer}`,
    "x-csrf-token": creds.csrf,
    "x-twitter-active-user": "yes",
    "x-twitter-auth-type": "OAuth2Session",
  };
}

/** Epoch seconds from the x-rate-limit-reset header, if present and numeric. */
export function rateLimitResetOf(res: Response): number | undefined {
  const raw = Number(res.headers.get("x-rate-limit-reset"));
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** One classifier rule over a parsed errors[] envelope; evaluated in order, first match wins. */
type ErrorRule =
  | { kind: "already-member"; messageMatch: RegExp }
  | { kind: "protected"; codes: number[]; messageMatch?: RegExp }
  | { kind: "rate-limited"; codes: number[] }
  | { kind: "auth"; codes: number[] };

/**
 * Per-endpoint description of how X's `errors[]` envelope maps to {@link XApiError}.
 * The two profiles sit side-by-side so every intentional REST/GraphQL divergence —
 * code sets, message patterns, resetAt, the rule ORDER, the join separator — is a
 * single data diff instead of being split across two backend files. The differences
 * are deliberately preserved (they target two different real X endpoints); reconciling
 * the accidental ones is a separate change.
 */
export interface ErrorProfile {
  /** Separator the errors[] messages are joined with for the thrown message. */
  joinSeparator: string;
  /** Classification rules, in evaluation order (the order itself is endpoint-specific). */
  rules: ErrorRule[];
  /** Message for an unrecognised errors[] payload. */
  unknownFallback: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const REST_PROFILE: ErrorProfile = {
  joinSeparator: "; ",
  rules: [
    { kind: "already-member", messageMatch: /already a member|already added/i },
    {
      kind: "protected",
      codes: [104],
      messageMatch: /protected|aren't allowed to add this member/i,
    },
    { kind: "rate-limited", codes: [88] },
    { kind: "auth", codes: [32, 89] },
  ],
  unknownFallback: "v1.1 error",
};

export const GRAPHQL_PROFILE: ErrorProfile = {
  joinSeparator: " ; ",
  // NB order differs from REST: rate-limited(88) is checked BEFORE protected(104).
  rules: [
    { kind: "already-member", messageMatch: /already a member/i },
    { kind: "rate-limited", codes: [88] },
    { kind: "protected", codes: [104] },
    { kind: "auth", codes: [353, 32] },
  ],
  unknownFallback: "Unknown GraphQL error",
};

/**
 * The X HTTP boundary: throws a typed {@link XApiError} on any failure, returns the
 * parsed JSON on success. Status pre-checks (429/auth) first, then the errors[]
 * envelope classified through the profile's ordered rules, then the non-ok fallback.
 */
export async function ensureOk(res: Response, profile: ErrorProfile): Promise<unknown> {
  if (res.status === 429) {
    // Every backend carries resetAt (reconciled 2026-06-21); undefined when X omits the header.
    throw new XApiError("rate-limited", "Rate limited (HTTP 429)", {
      resetAt: rateLimitResetOf(res),
    });
  }
  if (res.status === 401 || res.status === 403) {
    throw new XApiError("auth", `Auth error (HTTP ${res.status})`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  const envelope = isRecord(json) ? json : null;
  const hasErrors = envelope !== null && Object.hasOwn(envelope, "errors");
  const errors = hasErrors && envelope ? envelope.errors : undefined;
  if (hasErrors && (!Array.isArray(errors) || !errors.every(isRecord))) {
    throw new XApiError("unknown", profile.unknownFallback);
  }
  if (Array.isArray(errors) && errors.length > 0) {
    const message = errors
      .map((error) => (typeof error.message === "string" ? error.message : ""))
      .join(profile.joinSeparator);
    const codes = errors.map((error) => (typeof error.code === "number" ? error.code : undefined));
    for (const rule of profile.rules) {
      if (rule.kind === "already-member" && rule.messageMatch.test(message)) {
        throw new XApiError("already-member", message);
      }
      if (
        rule.kind === "protected" &&
        (rule.codes.some((c) => codes.includes(c)) || (rule.messageMatch?.test(message) ?? false))
      ) {
        throw new XApiError("protected", message);
      }
      if (rule.kind === "rate-limited" && rule.codes.some((c) => codes.includes(c))) {
        throw new XApiError("rate-limited", message, { resetAt: rateLimitResetOf(res) });
      }
      if (rule.kind === "auth" && rule.codes.some((c) => codes.includes(c))) {
        throw new XApiError("auth", message);
      }
    }
    throw new XApiError("unknown", message || profile.unknownFallback);
  }
  if (!res.ok) throw new XApiError("unknown", `HTTP ${res.status}`);
  return json;
}
