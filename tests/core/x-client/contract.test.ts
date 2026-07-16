import { describe, expect, it } from "vitest";

import type { TweetAuthor } from "@/core/selection-store";
import { DomXListApi } from "@/core/x-client/dom-api";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import type { PageDriver } from "@/core/x-client/page-driver";
import { RestXListApi } from "@/core/x-client/rest-api";
import type { Credentials, GraphqlConfig, XList, XListApi } from "@/core/x-client/types";

const LIST: XList = { id: "Research", name: "Research" };
const AUTHOR: TweetAuthor = { screenName: "jack", userId: "12" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- REST backend builders (the production default) ---
const restFetch =
  (body: unknown): typeof fetch =>
  (async () => jsonResponse(body)) as unknown as typeof fetch;
const restFresh = (): XListApi => new RestXListApi(restFetch({}), () => creds);
const restMember = (): XListApi =>
  new RestXListApi(restFetch({ errors: [{ message: "already a member" }] }), () => creds);

// --- GraphQL backend builders ---
const creds: Credentials = { csrf: "c", bearer: "b" };
const config: GraphqlConfig = {
  baseUrl: "https://x.com/i/api/graphql",
  ops: { ListAddMember: "add", ListRemoveMember: "rm", UserByScreenName: "u" },
  features: {},
};
const gqlFresh = (): XListApi =>
  new GraphqlXListApi(creds, {
    fetch: (async () => jsonResponse({ data: { list: {} } })) as unknown as typeof fetch,
    config,
  });
const gqlMember = (): XListApi =>
  new GraphqlXListApi(creds, {
    fetch: (async () =>
      jsonResponse({
        errors: [{ message: "User is already a member of this List." }],
      })) as unknown as typeof fetch,
    config,
  });

// --- DOM backend builders ---
class Driver implements PageDriver {
  checked: Set<string>;
  constructor(checked: string[] = []) {
    this.checked = new Set(checked);
  }
  async openListsDialog(): Promise<void> {}
  async listNames(): Promise<string[]> {
    return ["Research"];
  }
  async isChecked(n: string): Promise<boolean> {
    return this.checked.has(n);
  }
  async toggleList(n: string): Promise<void> {
    this.checked.add(n);
  }
  async commit(): Promise<void> {}
  async close(): Promise<void> {}
}
const domFresh = (): XListApi => new DomXListApi(new Driver());
const domMember = (): XListApi => new DomXListApi(new Driver(["Research"]));

const backends = [
  { label: "RestXListApi", fresh: restFresh, member: restMember },
  { label: "GraphqlXListApi", fresh: gqlFresh, member: gqlMember },
  { label: "DomXListApi", fresh: domFresh, member: domMember },
];

// Every production Backend honors the SAME mutation contract (add + remove). Discovery
// (getLists) is deliberately absent — it is strategy-independent (ADR-0008), not here.
describe.each(backends)("XListApi contract: $label", ({ fresh, member }) => {
  it("addMember resolves for a non-member", async () => {
    await expect(fresh().addMember(LIST, AUTHOR)).resolves.toBeUndefined();
  });

  it("addMember throws an already-member XApiError for an existing member", async () => {
    await expect(member().addMember(LIST, AUTHOR)).rejects.toMatchObject({
      kind: "already-member",
    });
  });

  it("removeMember resolves", async () => {
    await expect(fresh().removeMember(LIST, AUTHOR)).resolves.toBeUndefined();
  });
});
