import { localArea } from "@/core/storage-areas";

import type { GraphqlOpsCache, GraphqlOpsCacheEntry } from "./graphql-ops";

const KEY = "lasso.graphqlOps.v1";

/** Narrows persisted storage to a usable entry; anything else reads as empty. */
function isEntry(raw: unknown): raw is GraphqlOpsCacheEntry {
  if (typeof raw !== "object" || raw === null) return false;
  if (!("ops" in raw) || !("fetchedAt" in raw)) return false;
  const { ops, fetchedAt } = raw;
  if (typeof fetchedAt !== "number" || typeof ops !== "object" || ops === null) return false;
  if (!("ListAddMember" in ops) || !("ListRemoveMember" in ops) || !("UserByScreenName" in ops)) {
    return false;
  }
  return (
    typeof ops.ListAddMember === "string" &&
    typeof ops.ListRemoveMember === "string" &&
    typeof ops.UserByScreenName === "string"
  );
}

/**
 * chrome.storage.local persistence for scraped GraphQL query ids — a scrape survives
 * browser restarts, so the common path never re-fetches X's bundles. The key is
 * versioned: a shape change ships a new key instead of a migration.
 */
export function createChromeOpsCache(): GraphqlOpsCache {
  return {
    async read() {
      const raw = (await localArea().get(KEY))[KEY];
      return isEntry(raw) ? raw : null;
    },
    async write(entry) {
      await localArea().set({ [KEY]: entry });
    },
  };
}
