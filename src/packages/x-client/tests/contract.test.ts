import { describe, expect, it } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { DomXListApi } from "@/packages/x-client/dom-api";
import type { PageDriver } from "@/packages/x-client/dom-page-driver";
import { GraphqlXListApi } from "@/packages/x-client/graphql-api";
import { RestXListApi } from "@/packages/x-client/rest-api";
import type { Credentials, GraphqlClientConfig, XList, XListApi } from "@/packages/x-client/types";

const LIST: XList = { id: "Research", name: "Research" };
const AUTHOR: TweetAuthor = { screenName: "jack", userId: "12" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- GraphQL backend builders ---
const creds: Credentials = { csrf: "c", bearer: "b" };
const config: GraphqlClientConfig = {
  baseUrl: "https://x.com/i/api/graphql",
  catalog: {
    ListAddMember: { queryId: "add", features: {} },
    ListRemoveMember: { queryId: "rm", features: {} },
    UserByScreenName: { queryId: "u", features: {} },
  },
};
const gqlCatalog = { resolve: async () => config.catalog, refresh: async () => config.catalog };
const gqlFresh = (): XListApi =>
  new GraphqlXListApi(() => creds, {
    fetch: (async () => jsonResponse({ data: { list: {} } })) as unknown as typeof fetch,
    config,
    catalog: gqlCatalog,
  });
const gqlMember = (): XListApi =>
  new GraphqlXListApi(() => creds, {
    fetch: (async () =>
      jsonResponse({
        errors: [{ message: "User is already a member of this List." }],
      })) as unknown as typeof fetch,
    config,
    catalog: gqlCatalog,
  });

// --- DOM backend builders ---
class Driver implements PageDriver {
  checked: Set<string>;
  constructor(checked: string[] = []) {
    this.checked = new Set(checked);
  }
  async openListsDialog(): Promise<void> {}
  async isChecked(list: XList): Promise<boolean> {
    return this.checked.has(list.id);
  }
  async toggleList(list: XList): Promise<void> {
    if (this.checked.has(list.id)) this.checked.delete(list.id);
    else this.checked.add(list.id);
  }
  async commit(): Promise<"immediate"> {
    return "immediate";
  }
  async close(): Promise<void> {}
}
const domFresh = (): XListApi => new DomXListApi(new Driver());
const domMember = (): XListApi => new DomXListApi(new Driver([LIST.id]));

// --- REST backend builders (ADR-0007 default — now enrolled in the shared contract) ---
const restFetch = (res: () => Response): typeof fetch =>
  (async () => res()) as unknown as typeof fetch;
const restFresh = (): XListApi =>
  new RestXListApi(
    restFetch(() => jsonResponse({})),
    () => creds,
  );
const restMember = (): XListApi =>
  new RestXListApi(
    restFetch(() =>
      jsonResponse({ errors: [{ message: "User is already a member of this List." }] }),
    ),
    () => creds,
  );

const backends = [
  {
    label: "GraphqlXListApi",
    evidence: "server-response",
    fresh: gqlFresh,
    member: gqlMember,
    removable: gqlFresh,
  },
  {
    label: "DomXListApi",
    evidence: "ui-state",
    fresh: domFresh,
    member: domMember,
    removable: domMember,
  },
  {
    label: "RestXListApi",
    evidence: "server-response",
    fresh: restFresh,
    member: restMember,
    removable: restFresh,
  },
];

describe.each(backends)("XListApi contract: $label", ({ evidence, fresh, member, removable }) => {
  it("declares the strength of its mutation receipt", () => {
    expect(fresh().evidence).toBe(evidence);
  });
  it("addMember resolves for a non-member", async () => {
    await expect(fresh().addMember(LIST, AUTHOR)).resolves.toBeUndefined();
  });

  it("addMember throws an already-member XApiError for an existing member", async () => {
    await expect(member().addMember(LIST, AUTHOR)).rejects.toMatchObject({
      kind: "already-member",
    });
  });

  it("removeMember resolves for an existing member", async () => {
    await expect(removable().removeMember(LIST, AUTHOR)).resolves.toBeUndefined();
  });
});

// HTTP-backend error parity (REST + GraphQL only — the DOM backend does no HTTP,
// so it can't produce these failures). Locks the shared failure taxonomy: the same
// canned X failure must classify to the same XApiError.kind across both HTTP backends.
// Deliberately kind-only. resetAt on rate-limited now AGREES (both attach it as of
// 2026-06-21). The remaining intentional divergences are pinned per-backend:
//   • the "already added" message variant (REST matches, GraphQL doesn't) — rest-api.test.ts
//   • disjoint auth codes (REST 89, GraphQL 353; 32 is shared) — rest-api.test.ts, graphql-api.test.ts
const httpBackends = [
  {
    label: "RestXListApi",
    build: (res: () => Response): XListApi => new RestXListApi(restFetch(res), () => creds),
  },
  {
    label: "GraphqlXListApi",
    build: (res: () => Response): XListApi =>
      new GraphqlXListApi(() => creds, { fetch: restFetch(res), config, catalog: gqlCatalog }),
  },
];

const PARITY_CASES = [
  { name: "HTTP 401", response: () => jsonResponse({}, 401), kind: "auth" },
  { name: "HTTP 403", response: () => jsonResponse({}, 403), kind: "auth" },
  { name: "HTTP 429", response: () => jsonResponse({}, 429), kind: "rate-limited" },
  {
    name: "code 104",
    response: () => jsonResponse({ errors: [{ code: 104 }] }),
    kind: "protected",
  },
  {
    name: "code 88",
    response: () => jsonResponse({ errors: [{ code: 88 }] }),
    kind: "rate-limited",
  },
  { name: "code 32", response: () => jsonResponse({ errors: [{ code: 32 }] }), kind: "auth" },
  {
    name: "unrecognized error",
    response: () => jsonResponse({ errors: [{ code: 999 }] }),
    kind: "unknown",
  },
] as const;

describe.each(PARITY_CASES)("XListApi HTTP error parity: $name", ({ response, kind }) => {
  it.each(httpBackends)(`$label maps it to ${kind}`, async ({ build }) => {
    await expect(build(response).addMember(LIST, AUTHOR)).rejects.toMatchObject({ kind });
  });
});

// HTTP error PRECEDENCE — an intentional REST/GraphQL divergence the kind-only parity
// block above cannot express (it asserts agreement). A payload carrying BOTH code 88
// (rate-limited) and 104 (protected): REST checks protected first, GraphQL checks
// rate-limited first. Pinned here so any change to the per-backend rule ORDER is caught —
// no other test combines the two codes, so this flip would otherwise shift silently.
describe("XListApi HTTP error precedence (intentional divergence)", () => {
  const bothCodes = (): Response => jsonResponse({ errors: [{ code: 88 }, { code: 104 }] });

  it("REST classifies {88,104} as protected (104 checked before 88)", async () => {
    const rest = new RestXListApi(restFetch(bothCodes), () => creds);
    await expect(rest.addMember(LIST, AUTHOR)).rejects.toMatchObject({ kind: "protected" });
  });

  it("GraphQL classifies {88,104} as rate-limited (88 checked before 104)", async () => {
    const graphql = new GraphqlXListApi(() => creds, {
      fetch: restFetch(bothCodes),
      config,
      catalog: gqlCatalog,
    });
    await expect(graphql.addMember(LIST, AUTHOR)).rejects.toMatchObject({ kind: "rate-limited" });
  });
});
