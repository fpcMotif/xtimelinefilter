/** Stable key for one X person in the cached Membership model. */
export type MembershipIdentity = `user:${string}` | `tweet:${string}`;

export interface MembershipIdentitySource {
  userId?: string;
  tweetId?: string;
}

/**
 * Builds the only key allowed for cached Membership state. X user ids survive
 * handle changes. A tweet id is a conservative fallback tied to one observed
 * post. A handle is display data and must never become cache identity.
 */
export function membershipIdentityOf(source: MembershipIdentitySource): MembershipIdentity | null {
  const userId = source.userId?.trim();
  if (userId) return `user:${userId}`;
  const tweetId = source.tweetId?.trim();
  return tweetId ? `tweet:${tweetId}` : null;
}
