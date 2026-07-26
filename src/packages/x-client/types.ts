import type { TweetAuthor } from "@/core/selection-store";

import type { GraphqlOperationCatalog } from "./graphql-contract";

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
  | "already-absent"
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

/** What accepted the mutation. UI state is useful audit evidence, not X server truth. */
export type MutationEvidence = "server-response" | "ui-state";

/** A remove either changes membership or confirms it was already absent. */
export type RemoveOutcome = "removed" | "already-absent" | "protected" | "rate-limited" | "failed";

export interface AssignResult {
  author: TweetAuthor;
  outcome: AssignOutcome;
  evidence: MutationEvidence;
  /** Epoch milliseconds when this backend attempt settled. */
  observedAt: number;
  message?: string;
  /** Carried from a rate-limited failure so feedback can say "try again in N min". */
  resetAt?: number;
}

/** The mutation seam every backend implements. */
export interface XListApi {
  /** Strength of this adapter's mutation receipt. */
  readonly evidence: MutationEvidence;
  /** Adds the author to the list; throws {@link XApiError} on failure. */
  addMember(list: XList, author: TweetAuthor): Promise<void>;
  removeMember(list: XList, author: TweetAuthor): Promise<void>;
}

/** Supplies one stable adapter for each user-initiated membership run. */
export interface XListApiSource {
  snapshot(): XListApi;
}

/** Base URL plus the static, complete fallback catalog. */
export interface GraphqlClientConfig {
  baseUrl: string;
  catalog: GraphqlOperationCatalog;
}
