import { describe, expect, it } from "vitest";

import { assignAuthorsToList } from "@/core/actions/assign-to-list";
import type { TweetAuthor } from "@/core/selection-store";
import { XApiError, type XList, type XListApi } from "@/core/x-client/types";

class FakeApi implements XListApi {
  added: string[] = [];
  addImpl: (author: TweetAuthor) => Promise<void> = async () => {};
  async getLists(): Promise<XList[]> {
    return [];
  }
  async resolveUserId(): Promise<string | null> {
    return null;
  }
  async addMember(_list: XList, author: TweetAuthor): Promise<void> {
    this.added.push(author.screenName);
    return this.addImpl(author);
  }
  async removeMember(): Promise<void> {}
}

const LIST: XList = { id: "L", name: "Research" };
const noSleep = { sleep: async () => {} };
const a = (screenName: string, userId?: string): TweetAuthor => ({ screenName, userId });

describe("assignAuthorsToList", () => {
  it("adds every author in order", async () => {
    const api = new FakeApi();
    const res = await assignAuthorsToList([a("x"), a("y")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "added"]);
    expect(api.added).toEqual(["x", "y"]);
  });

  it("treats already-member as idempotent success and continues", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw new XApiError("already-member", "already a member");
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "already-member", "added"]);
    expect(api.added).toEqual(["x", "y", "z"]);
  });

  it("STOPS the run on rate-limited (honors backoff) — later authors untouched", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw new XApiError("rate-limited", "429");
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "rate-limited"]);
    expect(api.added).toEqual(["x", "y"]);
  });

  it("maps not-found (unresolvable id) to failed and continues", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw new XApiError("not-found", "no id");
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "failed", "added"]);
  });

  it("maps unknown/non-XApiError throws to failed and continues", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw new Error("boom");
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "failed", "added"]);
  });

  it("paces adds with an injected sleep between items (not before the first)", async () => {
    const api = new FakeApi();
    const sleeps: number[] = [];
    await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      delayMs: 1000,
      jitter: 0,
      random: () => 0.5,
    });
    expect(sleeps).toEqual([1000, 1000]);
  });
});

describe("story beat 7 — progress + Stop", () => {
  it("reports 1-based progress before each attempt", async () => {
    const api = new FakeApi();
    const seen: Array<[number, number]> = [];
    await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, {
      ...noSleep,
      onProgress: (current, total) => seen.push([current, total]),
    });
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("Stop aborts the remaining calls and leaves un-attempted authors out of the results", async () => {
    const api = new FakeApi();
    let stop = false;
    api.addImpl = async (au) => {
      if (au.screenName === "y") stop = true; // user hits Stop while y is in flight
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, {
      ...noSleep,
      shouldStop: () => stop,
    });
    expect(res.map((r) => r.outcome)).toEqual(["added", "added"]);
    expect(api.added).toEqual(["x", "y"]); // z never attempted
  });

  it("carries the rate-limit reset time onto the result", async () => {
    const api = new FakeApi();
    api.addImpl = async () => {
      throw new XApiError("rate-limited", "429", { resetAt: 1750000000 });
    };
    const res = await assignAuthorsToList([a("x")], LIST, api, noSleep);
    expect(res[0]).toMatchObject({ outcome: "rate-limited", resetAt: 1750000000 });
  });
});
