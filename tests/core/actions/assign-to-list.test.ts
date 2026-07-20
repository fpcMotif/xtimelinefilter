import { describe, expect, it, vi } from "vitest";

import { assignAuthorsToList, removeAuthorsFromList } from "@/core/actions/assign-to-list";
import type { TweetAuthor } from "@/core/selection-store";
import { XApiError, type XList, type XListApi } from "@/packages/x-client/types";

class FakeApi implements XListApi {
  added: string[] = [];
  removed: string[] = [];
  addImpl: (author: TweetAuthor) => Promise<void> = async () => {};
  removeImpl: (author: TweetAuthor) => Promise<void> = async () => {};
  async addMember(_list: XList, author: TweetAuthor): Promise<void> {
    this.added.push(author.screenName);
    return this.addImpl(author);
  }
  async removeMember(_list: XList, author: TweetAuthor): Promise<void> {
    this.removed.push(author.screenName);
    return this.removeImpl(author);
  }
}

const LIST: XList = { id: "L", name: "Research" };
const noSleep = { sleep: async () => {} };
const a = (screenName: string, userId?: string): TweetAuthor => ({ screenName, userId });

describe("assignAuthorsToList", () => {
  it("timestamps each result when its backend attempt settles", async () => {
    const api = new FakeApi();
    const events: string[] = [];
    const times = [101, 202, 303];
    api.addImpl = async (author) => {
      events.push(`attempt:${author.screenName}`);
      if (author.screenName === "y") throw new Error("boom");
    };

    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, {
      ...noSleep,
      now: () => {
        events.push("now");
        return times.shift() as number;
      },
    });

    expect(events).toEqual(["attempt:x", "now", "attempt:y", "now", "attempt:z", "now"]);
    expect(res.map((result) => result.observedAt)).toEqual([101, 202, 303]);
  });

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

  it("maps protected users to protected and continues", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw new XApiError("protected", "private");
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "protected", "added"]);
  });

  it("maps unknown/non-XApiError throws to failed and continues", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw new Error("boom");
    };
    const res = await assignAuthorsToList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["added", "failed", "added"]);
  });

  it("stringifies non-Error throws in the result message", async () => {
    const api = new FakeApi();
    api.addImpl = async (au) => {
      if (au.screenName === "y") throw "string boom";
    };
    const res = await assignAuthorsToList([a("x"), a("y")], LIST, api, noSleep);
    expect(res[1]).toMatchObject({ outcome: "failed", message: "string boom" });
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

  it("uses the default sleep and default jitter options", async () => {
    const api = new FakeApi();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementation((cb) => {
      if (typeof cb === "function") cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });

    await assignAuthorsToList([a("x"), a("y")], LIST, api, { delayMs: 0 });

    expect(api.added).toEqual(["x", "y"]);
    expect(random).toHaveBeenCalled();
    expect(timeout).toHaveBeenCalled();
    random.mockRestore();
    timeout.mockRestore();
  });

  it("applies low and high jitter around the base delay", async () => {
    const lowSleeps: number[] = [];
    await assignAuthorsToList([a("x"), a("y")], LIST, new FakeApi(), {
      sleep: async (ms) => {
        lowSleeps.push(ms);
      },
      delayMs: 1000,
      jitter: 0.25,
      random: () => 0,
    });
    const highSleeps: number[] = [];
    await assignAuthorsToList([a("x"), a("y")], LIST, new FakeApi(), {
      sleep: async (ms) => {
        highSleeps.push(ms);
      },
      delayMs: 1000,
      jitter: 0.25,
      random: () => 1,
    });
    expect(lowSleeps).toEqual([750]);
    expect(highSleeps).toEqual([1250]);
  });
});

describe("removeAuthorsFromList — undo under the same policy", () => {
  it("removes every author in order and timestamps each attempt", async () => {
    const api = new FakeApi();
    const times = [101, 202];
    const res = await removeAuthorsFromList([a("x"), a("y")], LIST, api, {
      ...noSleep,
      now: () => times.shift() as number,
    });
    expect(res.map((r) => r.outcome)).toEqual(["removed", "removed"]);
    expect(res.map((r) => r.observedAt)).toEqual([101, 202]);
    expect(api.removed).toEqual(["x", "y"]);
  });

  it("paces removes with an injected sleep between items (not before the first)", async () => {
    const api = new FakeApi();
    const sleeps: number[] = [];
    await removeAuthorsFromList([a("x"), a("y"), a("z")], LIST, api, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      delayMs: 1000,
      jitter: 0,
      random: () => 0.5,
    });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("STOPS on rate-limited — later authors un-attempted, carries the reset time", async () => {
    const api = new FakeApi();
    api.removeImpl = async (au) => {
      if (au.screenName === "y")
        throw new XApiError("rate-limited", "429", { resetAt: 1750000000 });
    };
    const res = await removeAuthorsFromList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["removed", "rate-limited"]);
    expect(api.removed).toEqual(["x", "y"]); // z never attempted
    expect(res[1]).toMatchObject({ outcome: "rate-limited", resetAt: 1750000000 });
  });

  it("maps a non-rate-limit error to failed and keeps going", async () => {
    const api = new FakeApi();
    api.removeImpl = async (au) => {
      if (au.screenName === "y") throw new Error("remove boom");
    };
    const res = await removeAuthorsFromList([a("x"), a("y"), a("z")], LIST, api, noSleep);
    expect(res.map((r) => r.outcome)).toEqual(["removed", "failed", "removed"]);
    expect(res[1]).toMatchObject({ outcome: "failed", message: "remove boom" });
  });

  it("stringifies non-Error throws in the remove result message", async () => {
    const api = new FakeApi();
    api.removeImpl = async (au) => {
      if (au.screenName === "y") throw "string boom";
    };
    const res = await removeAuthorsFromList([a("x"), a("y")], LIST, api, noSleep);
    expect(res[1]).toMatchObject({ outcome: "failed", message: "string boom" });
  });

  it("uses the default sleep between removes", async () => {
    const api = new FakeApi();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const timeout = vi.spyOn(globalThis, "setTimeout").mockImplementation((cb) => {
      if (typeof cb === "function") cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });

    await removeAuthorsFromList([a("x"), a("y")], LIST, api, { delayMs: 0 });

    expect(api.removed).toEqual(["x", "y"]);
    expect(random).toHaveBeenCalled();
    expect(timeout).toHaveBeenCalled();
    random.mockRestore();
    timeout.mockRestore();
  });

  it("shouldStop during pacing prevents the next remove", async () => {
    const api = new FakeApi();
    let stop = false;
    let releaseSleep!: () => void;
    let enteredSleep!: () => void;
    const sleepEntered = new Promise<void>((resolve) => {
      enteredSleep = resolve;
    });
    const res = removeAuthorsFromList([a("x"), a("y")], LIST, api, {
      sleep: async () => {
        enteredSleep();
        await new Promise<void>((resolve) => {
          releaseSleep = resolve;
        });
      },
      now: () => 456,
      shouldStop: () => stop,
    });

    await sleepEntered;
    stop = true;
    releaseSleep();

    await expect(res).resolves.toEqual([{ author: a("x"), outcome: "removed", observedAt: 456 }]);
    expect(api.removed).toEqual(["x"]);
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

  it("Stop during pacing prevents the next attempt", async () => {
    const api = new FakeApi();
    let stop = false;
    let releaseSleep!: () => void;
    let enteredSleep!: () => void;
    const sleepEntered = new Promise<void>((resolve) => {
      enteredSleep = resolve;
    });
    const res = assignAuthorsToList([a("x"), a("y")], LIST, api, {
      sleep: async () => {
        enteredSleep();
        await new Promise<void>((resolve) => {
          releaseSleep = resolve;
        });
      },
      now: () => 456,
      shouldStop: () => stop,
    });

    await sleepEntered;
    stop = true;
    releaseSleep();

    await expect(res).resolves.toEqual([{ author: a("x"), outcome: "added", observedAt: 456 }]);
    expect(api.added).toEqual(["x"]);
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
