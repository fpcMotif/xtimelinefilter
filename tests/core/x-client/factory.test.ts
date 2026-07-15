import { describe, expect, it, vi } from "vitest";

import type { Auth } from "@/core/x-client/auth";
import { DomXListApi } from "@/core/x-client/dom-api";
import { createXListApi } from "@/core/x-client/factory";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import { RestXListApi } from "@/core/x-client/rest-api";

const stubFetch = (async () => new Response("{}")) as unknown as typeof fetch;
const auth: Auth = { credentials: () => ({ csrf: "c", bearer: "b" }) };
const deps = { fetch: stubFetch, auth };

describe("createXListApi", () => {
  it("returns the REST backend by default", () => {
    expect(createXListApi("rest", deps)).toBeInstanceOf(RestXListApi);
  });

  it("returns the DOM and GraphQL backends when selected", () => {
    // Constructing DOM also proves createDomPageDriver() is inert under happy-dom.
    expect(createXListApi("dom", deps)).toBeInstanceOf(DomXListApi);
    expect(createXListApi("graphql", deps)).toBeInstanceOf(GraphqlXListApi);
  });

  it("only graphql evaluates credentials at construction — rest/dom stay lazy", () => {
    const boom: Auth = {
      credentials() {
        throw new Error("no ct0");
      },
    };
    const hostile = { fetch: stubFetch, auth: boom };
    expect(() => createXListApi("rest", hostile)).not.toThrow();
    expect(() => createXListApi("dom", hostile)).not.toThrow();
    expect(() => createXListApi("graphql", hostile)).toThrow("no ct0");
  });

  it("snapshots credentials once for graphql, defers them behind a thunk for rest", async () => {
    const credentials = vi.fn(() => ({ csrf: "c", bearer: "b" }));
    const spied = { fetch: stubFetch, auth: { credentials } };

    createXListApi("graphql", spied);
    expect(credentials).toHaveBeenCalledTimes(1); // eager snapshot at construction

    credentials.mockClear();
    const rest = createXListApi("rest", spied);
    expect(credentials).not.toHaveBeenCalled(); // untouched at construction
    await rest.getLists(); // first call evaluates the thunk
    expect(credentials).toHaveBeenCalledTimes(1);
  });
});
