import type { BackendStrategy, SettingsStore } from "@/core/settings";

import { createDocumentAuth } from "./auth";
import { createDomPageDriver } from "./dom-page-driver";
import { DEFAULT_GRAPHQL_CONFIG } from "./graphql-config";
import { createGraphqlCatalogResolver, type GraphqlCatalogCache } from "./graphql-ops";
import { fetchMembershipListIds, fetchOwnedLists } from "./lists-provider";
import { createLiveXListApi, type LiveXListApi } from "./live";
import { blockUser, muteUser, unmuteUser } from "./rest-api";
import type { XList, XListApiSource } from "./types";

/**
 * One page-scoped X capability. It hides session auth, same-origin fetch,
 * backend replacement, GraphQL catalog repair, List reads, and quick REST actions.
 */
export interface XPageClient {
  /** Snapshot one mutation adapter at the start of a user action. */
  readonly lists: XListApiSource;
  ownedLists(): Promise<XList[]>;
  membershipListIds(screenName: string): Promise<string[] | null>;
  mute(screenName: string): Promise<void>;
  unmute(screenName: string): Promise<void>;
  block(screenName: string): Promise<void>;
  /** Stop observing backend settings. Safe to call more than once. */
  dispose(): void;
}

export interface XPageClientOptions {
  initialBackend: BackendStrategy;
  settings: Pick<SettingsStore, "subscribe">;
  /** Worker-owned cache adapter; content owns the Chrome protocol boundary. */
  graphqlCache: GraphqlCatalogCache;
  /** Content knows how to find a Tweet's shared caret. */
  findAuthorCaret(screenName: string): Element | null;
  /** Content owns the keyboard-safe synthetic Escape policy. */
  dispatchSyntheticEscape(target: Document | Element): void;
  /** Test seam; production uses the page's same-origin fetch. */
  fetch?: typeof fetch;
  /** Test seam; production reads the current document's ct0 cookie. */
  getCookie?: () => string;
  /** Test seam and DOM-driver document owner. */
  document?: Document;
}

/**
 * Creates the complete X page capability. Content supplies only its page-local
 * DOM bridges and the worker cache adapter; all X transport policy stays here.
 */
export function createXPageClient(options: XPageClientOptions): XPageClient {
  const doc = options.document ?? document;
  const pageFetch = options.fetch ?? window.fetch.bind(window);
  const auth = createDocumentAuth({
    getCookie: options.getCookie ?? (() => doc.cookie),
  });
  const credentials = () => auth.credentials();
  const backend: LiveXListApi = createLiveXListApi(options.initialBackend, options.settings, {
    fetch: pageFetch,
    credentials,
    createPageDriver: () =>
      createDomPageDriver({
        doc,
        findAuthorCaret: options.findAuthorCaret,
        dispatchSyntheticEscape: options.dispatchSyntheticEscape,
      }),
    // Static IDs are only fallback seeds. The resolver owns compatible rotation.
    graphqlCatalog: createGraphqlCatalogResolver({
      fetch: pageFetch,
      cache: options.graphqlCache,
      fallback: DEFAULT_GRAPHQL_CONFIG.catalog,
    }),
  });
  const restDeps = () => ({ fetch: pageFetch, creds: credentials() });

  return {
    lists: backend,
    ownedLists: () => fetchOwnedLists(restDeps()),
    membershipListIds: (screenName) => fetchMembershipListIds(restDeps(), screenName),
    mute: (screenName) => muteUser(restDeps(), screenName),
    unmute: (screenName) => unmuteUser(restDeps(), screenName),
    block: (screenName) => blockUser(restDeps(), screenName),
    dispose: () => backend.dispose(),
  };
}
