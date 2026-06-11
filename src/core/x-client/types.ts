import type { TweetAuthor } from "@/core/selection-store";

/** Session credentials lifted from the logged-in X page context. */
export interface Credentials {
  /** ct0 cookie value, sent as x-csrf-token */
  csrf: string;
  /** authorization bearer token used by the web app */
  bearer: string;
}

/** A List the user owns / can add members to. */
export interface XList {
  id: string;
  name: string;
  memberCount?: number;
  /** Private Lists get a lock icon in the picker (story beat 4). */
  isPrivate?: boolean;
}

export type XApiErrorKind =
  | "already-member"
  | "rate-limited"
  | "protected"
  | "auth"
  | "not-found"
  | "unknown";

/** Typed failure from a backend so callers can react without string-matching. */
export class XApiError extends Error {
  readonly kind: XApiErrorKind;
  /** Epoch seconds from x-rate-limit-reset, when X provided one (kind "rate-limited"). */
  readonly resetAt?: number;
  constructor(kind: XApiErrorKind, message: string, opts: { resetAt?: number } = {}) {
    super(message);
    this.name = "XApiError";
    this.kind = kind;
    this.resetAt = opts.resetAt;
  }
}

export type AssignOutcome = "added" | "already-member" | "protected" | "rate-limited" | "failed";

export interface AssignResult {
  author: TweetAuthor;
  outcome: AssignOutcome;
  message?: string;
  /** Carried from a rate-limited failure so feedback can say "try again in N min". */
  resetAt?: number;
}

/**
 * The seam every backend implements. The DOM and GraphQL strategies are
 * interchangeable; consumers depend only on this interface.
 */
export interface XListApi {
  getLists(): Promise<XList[]>;
  /** Resolve a handle to a numeric id (GraphQL needs it; DOM returns null). */
  resolveUserId(screenName: string): Promise<string | null>;
  /** Adds the author to the list; throws {@link XApiError} on failure. */
  addMember(list: XList, author: TweetAuthor): Promise<void>;
  removeMember(list: XList, author: TweetAuthor): Promise<void>;
}

/** Configuration for the GraphQL backend (query ids drift; keep them here). */
export interface GraphqlConfig {
  baseUrl: string;
  ops: {
    ListAddMember: string;
    ListRemoveMember: string;
    UserByScreenName: string;
  };
  features: Record<string, boolean>;
}
