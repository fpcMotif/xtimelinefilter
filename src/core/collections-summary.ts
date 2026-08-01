import { requestCollections, type CollectionCounts } from "@/core/protocol/collections";

const TYPE = "lasso:collections";

/**
 * The popup's entire collections grant (ADR-0013): one account-free read of
 * how much the user has kept. One-shot by design — the row registers no
 * subscription or storage watch, because the timeline cannot be touched while
 * the popup has focus, so a second channel would buy nothing.
 *
 * Fail-soft: a request that throws, rejects, or resolves to a shape this
 * operation would never produce leaves the Saved row simply absent rather than
 * breaking the popup. `requestCollections` already re-validates the response
 * against the `counts` operation's exact key set, so `"counts" in response`
 * is enough to narrow — a malformed answer throws before reaching here.
 */
export async function readSavedSummary(): Promise<CollectionCounts | null> {
  try {
    const response = await requestCollections({ type: TYPE, operation: "counts" });
    return "counts" in response ? response.counts : null;
  } catch {
    return null;
  }
}
