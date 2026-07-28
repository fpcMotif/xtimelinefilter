import { afterEach, describe, expect, it, vi } from "vitest";

import type { CacheObservation } from "@/core/cache-observation";
import {
  COLLECTIONS_OPERATIONS,
  COLLECTIONS_WRITES,
  type CollectionsOperation,
  type CollectionsRequest,
  isCollectionsRequest,
  MAX_CURSOR,
  MAX_FOLDER_NAME,
  MAX_LIVE_FOLDERS,
  MAX_NOTE,
  MAX_PAGE_LIMIT,
  MAX_TAG,
  MAX_TAGS,
  requestCollections,
} from "@/core/protocol/collections";
import { isListCacheRequest } from "@/core/protocol/list-cache";
import type { PostCapture } from "@/packages/folders/types";

const TYPE = "lasso:collections";
const TOKEN: CacheObservation = { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 };
const FOLDER = "fld_abcdefghijklmnopqrst";
const STATUS = "1234567890";

const capture: PostCapture = {
  statusId: STATUS,
  permalink: `https://x.com/jack/status/${STATUS}`,
  author: { screenName: "jack", userId: "12" },
  text: "hello",
  media: [{ kind: "photo", url: "https://pbs.twimg.com/media/a.jpg" }],
  postedAt: "2026-07-20T10:00:00.000Z",
};

/** One valid request per operation — the table every enumeration test walks. */
const VALID: Record<CollectionsOperation, CollectionsRequest> = {
  begin: { type: TYPE, operation: "begin" },
  "list-folders": { type: TYPE, operation: "list-folders", includeDeleted: false },
  "folders-holding": { type: TYPE, operation: "folders-holding", statusId: STATUS },
  "create-folder": { type: TYPE, operation: "create-folder", name: "Research", token: TOKEN },
  "rename-folder": {
    type: TYPE,
    operation: "rename-folder",
    folderId: FOLDER,
    name: "Design",
    token: TOKEN,
  },
  "reorder-folders": {
    type: TYPE,
    operation: "reorder-folders",
    folderIds: [FOLDER],
    token: TOKEN,
  },
  "delete-folder": {
    type: TYPE,
    operation: "delete-folder",
    folderId: FOLDER,
    disposition: "keep-posts",
    token: TOKEN,
  },
  "save-post": { type: TYPE, operation: "save-post", folderId: FOLDER, capture, token: TOKEN },
  "remove-from-folder": {
    type: TYPE,
    operation: "remove-from-folder",
    folderId: FOLDER,
    statusId: STATUS,
    token: TOKEN,
  },
  "delete-saved-post": {
    type: TYPE,
    operation: "delete-saved-post",
    statusId: STATUS,
    token: TOKEN,
  },
  "get-saved-post": { type: TYPE, operation: "get-saved-post", statusId: STATUS },
  "set-note": { type: TYPE, operation: "set-note", statusId: STATUS, note: "why", token: TOKEN },
  "set-tags": { type: TYPE, operation: "set-tags", statusId: STATUS, tags: ["ml"], token: TOKEN },
  "record-bookmark-evidence": {
    type: TYPE,
    operation: "record-bookmark-evidence",
    statusId: STATUS,
    xAccountId: "acct-1",
    outcome: "confirmed",
    observedAt: 10,
    token: TOKEN,
  },
  "list-bookmark-evidence": { type: TYPE, operation: "list-bookmark-evidence", statusId: STATUS },
  "count-folder": { type: TYPE, operation: "count-folder", folderId: FOLDER },
  counts: { type: TYPE, operation: "counts" },
  "read-folder-page": {
    type: TYPE,
    operation: "read-folder-page",
    folderId: FOLDER,
    limit: 25,
    cursor: null,
  },
};

const rest = (n: number, fill = "x"): string => fill.repeat(n);

describe("collections request guard", () => {
  it("accepts one valid request per declared operation", () => {
    expect(Object.keys(VALID).toSorted()).toEqual([...COLLECTIONS_OPERATIONS].toSorted());
    for (const operation of COLLECTIONS_OPERATIONS) {
      expect(isCollectionsRequest(VALID[operation]), operation).toBe(true);
    }
  });

  it("rejects a foreign type, a non-record and an unknown operation", () => {
    expect(isCollectionsRequest(null)).toBe(false);
    expect(isCollectionsRequest([])).toBe(false);
    expect(isCollectionsRequest({ type: "lasso:filter", operation: "counts" })).toBe(false);
    expect(isCollectionsRequest({ type: TYPE, operation: "drop-everything" })).toBe(false);
    expect(isCollectionsRequest({ type: TYPE, operation: 7 })).toBe(false);
  });

  it("rejects an extra key and a missing key on every operation", () => {
    for (const operation of COLLECTIONS_OPERATIONS) {
      const valid = VALID[operation] as Record<string, unknown>;
      expect(isCollectionsRequest({ ...valid, extra: 1 }), `${operation} +extra`).toBe(false);
      for (const key of Object.keys(valid)) {
        const { [key]: _dropped, ...missing } = valid;
        expect(isCollectionsRequest(missing), `${operation} -${key}`).toBe(false);
      }
    }
  });

  it("fences exactly the writes with an observation token", () => {
    for (const operation of COLLECTIONS_OPERATIONS) {
      const valid = VALID[operation] as Record<string, unknown>;
      const isWrite = COLLECTIONS_WRITES.includes(operation);
      expect(Object.hasOwn(valid, "token"), `${operation} token presence`).toBe(isWrite);
      if (isWrite) {
        expect(isCollectionsRequest({ ...valid, token: { epoch: "nope", sequence: 1 } })).toBe(
          false,
        );
        expect(isCollectionsRequest({ ...valid, token: null })).toBe(false);
      }
    }
  });

  it("rejects wrong types on each operation's own fields", () => {
    expect(isCollectionsRequest({ ...VALID["list-folders"], includeDeleted: "yes" })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["folders-holding"], statusId: "0123" })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["create-folder"], name: "   " })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["rename-folder"], folderId: "not-a-folder" })).toBe(
      false,
    );
    expect(isCollectionsRequest({ ...VALID["reorder-folders"], folderIds: ["nope"] })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["delete-folder"], disposition: "burn-it" })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["set-note"], note: 7 })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["set-tags"], tags: [""] })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["record-bookmark-evidence"], outcome: "maybe" })).toBe(
      false,
    );
    expect(isCollectionsRequest({ ...VALID["record-bookmark-evidence"], observedAt: -1 })).toBe(
      false,
    );
    expect(isCollectionsRequest({ ...VALID["record-bookmark-evidence"], xAccountId: "" })).toBe(
      false,
    );
    expect(isCollectionsRequest({ ...VALID["read-folder-page"], limit: 0 })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["read-folder-page"], cursor: 7 })).toBe(false);
  });

  it("validates the capture it will store, including its nested shapes", () => {
    const save = VALID["save-post"] as Record<string, unknown>;
    // A capture with no durable id is VALID on the wire — the worker answers
    // "unsavable" rather than the surface having to pre-judge it.
    expect(
      isCollectionsRequest({ ...save, capture: { statusId: null, permalink: null, media: [] } }),
    ).toBe(true);
    expect(isCollectionsRequest({ ...save, capture: { ...capture, statusId: "abc" } })).toBe(false);
    expect(isCollectionsRequest({ ...save, capture: { ...capture, ownerUserId: "9" } })).toBe(
      false,
    );
    expect(isCollectionsRequest({ ...save, capture: { statusId: STATUS, media: [] } })).toBe(false);
    expect(isCollectionsRequest({ ...save, capture: "not-a-record" })).toBe(false);
    expect(isCollectionsRequest({ ...save, capture: { statusId: STATUS, permalink: null } })).toBe(
      false,
    );
    expect(
      isCollectionsRequest({ ...save, capture: { ...capture, media: [{ kind: "gif" }] } }),
    ).toBe(false);
    expect(
      isCollectionsRequest({
        ...save,
        capture: { ...capture, author: { screenName: "jack", userId: "abc" } },
      }),
    ).toBe(false);
    expect(
      isCollectionsRequest({ ...save, capture: { ...capture, author: { screenName: "" } } }),
    ).toBe(false);
    expect(isCollectionsRequest({ ...save, capture: { ...capture, text: 7 } })).toBe(false);
    expect(isCollectionsRequest({ ...save, capture: { ...capture, postedAt: rest(65) } })).toBe(
      false,
    );
    expect(isCollectionsRequest({ ...save, capture: { ...capture, permalink: rest(2049) } })).toBe(
      false,
    );
    expect(
      isCollectionsRequest({
        ...save,
        capture: { ...capture, media: [{ kind: "video", url: rest(2049) }] },
      }),
    ).toBe(false);
  });
});

describe("declared bounds", () => {
  it("accepts a folder name at the bound and rejects one past it", () => {
    expect(isCollectionsRequest({ ...VALID["create-folder"], name: rest(MAX_FOLDER_NAME) })).toBe(
      true,
    );
    expect(
      isCollectionsRequest({ ...VALID["create-folder"], name: rest(MAX_FOLDER_NAME + 1) }),
    ).toBe(false);
  });

  it("counts code points, so an emoji costs the user one character", () => {
    expect(
      isCollectionsRequest({ ...VALID["create-folder"], name: "🎉".repeat(MAX_FOLDER_NAME) }),
    ).toBe(true);
  });

  it("accepts every array at its maximum and rejects one more", () => {
    const folderIds = Array.from({ length: MAX_LIVE_FOLDERS }, () => FOLDER);
    expect(isCollectionsRequest({ ...VALID["reorder-folders"], folderIds })).toBe(true);
    expect(
      isCollectionsRequest({ ...VALID["reorder-folders"], folderIds: [...folderIds, FOLDER] }),
    ).toBe(false);

    const tags = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(isCollectionsRequest({ ...VALID["set-tags"], tags })).toBe(true);
    expect(isCollectionsRequest({ ...VALID["set-tags"], tags: [...tags, "one-more"] })).toBe(false);
  });

  it("bounds every free-text field", () => {
    expect(isCollectionsRequest({ ...VALID["set-note"], note: rest(MAX_NOTE) })).toBe(true);
    expect(isCollectionsRequest({ ...VALID["set-note"], note: rest(MAX_NOTE + 1) })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["set-tags"], tags: [rest(MAX_TAG)] })).toBe(true);
    expect(isCollectionsRequest({ ...VALID["set-tags"], tags: [rest(MAX_TAG + 1)] })).toBe(false);
    expect(isCollectionsRequest({ ...VALID["read-folder-page"], cursor: rest(MAX_CURSOR) })).toBe(
      true,
    );
    expect(
      isCollectionsRequest({ ...VALID["read-folder-page"], cursor: rest(MAX_CURSOR + 1) }),
    ).toBe(false);
    expect(isCollectionsRequest({ ...VALID["read-folder-page"], limit: MAX_PAGE_LIMIT })).toBe(
      true,
    );
    expect(isCollectionsRequest({ ...VALID["read-folder-page"], limit: MAX_PAGE_LIMIT + 1 })).toBe(
      false,
    );
  });

  it("shares one X id rule with the List-cache family", () => {
    // Both import isXId; a drift between the two would mean one family accepting
    // an id the other rejects, which is how the duplicated literal went stale.
    const accepted = ["1", "1234567890", `1${"0".repeat(63)}`];
    const rejected = ["", "0", "01", "abc", " 1", `1${"0".repeat(64)}`];
    for (const value of accepted) {
      expect(isCollectionsRequest({ ...VALID["get-saved-post"], statusId: value }), value).toBe(
        true,
      );
      expect(
        isListCacheRequest({
          type: "lasso:list-cache",
          operation: "read",
          owner: { userId: value, screenName: "jack" },
        }),
        value,
      ).toBe(true);
    }
    for (const value of rejected) {
      expect(isCollectionsRequest({ ...VALID["get-saved-post"], statusId: value }), value).toBe(
        false,
      );
      expect(
        isListCacheRequest({
          type: "lasso:list-cache",
          operation: "read",
          owner: { userId: value, screenName: "jack" },
        }),
        value,
      ).toBe(false);
    }
  });
});

describe("account freedom on the wire", () => {
  const ACCOUNT_KEYS = ["owner", "ownerUserId", "screenName", "accountId", "twid", "xAccountId"];

  it("names xAccountId on exactly one operation and nowhere else", () => {
    for (const operation of COLLECTIONS_OPERATIONS) {
      const keys = Object.keys(VALID[operation]);
      const named = keys.filter((key) => ACCOUNT_KEYS.includes(key));
      expect(named, operation).toEqual(
        operation === "record-bookmark-evidence" ? ["xAccountId"] : [],
      );
    }
  });

  it("rejects an account key added to any other operation, including as a scope", () => {
    for (const operation of COLLECTIONS_OPERATIONS) {
      if (operation === "record-bookmark-evidence") continue;
      for (const key of ACCOUNT_KEYS) {
        expect(
          isCollectionsRequest({ ...VALID[operation], [key]: "999" }),
          `${operation} +${key}`,
        ).toBe(false);
      }
    }
  });

  it("pins each request's exact key set to a literal", () => {
    const expected: Record<CollectionsOperation, string[]> = {
      begin: ["type", "operation"],
      "list-folders": ["type", "operation", "includeDeleted"],
      "folders-holding": ["type", "operation", "statusId"],
      "create-folder": ["type", "operation", "name", "token"],
      "rename-folder": ["type", "operation", "folderId", "name", "token"],
      "reorder-folders": ["type", "operation", "folderIds", "token"],
      "delete-folder": ["type", "operation", "folderId", "disposition", "token"],
      "save-post": ["type", "operation", "folderId", "capture", "token"],
      "remove-from-folder": ["type", "operation", "folderId", "statusId", "token"],
      "delete-saved-post": ["type", "operation", "statusId", "token"],
      "get-saved-post": ["type", "operation", "statusId"],
      "set-note": ["type", "operation", "statusId", "note", "token"],
      "set-tags": ["type", "operation", "statusId", "tags", "token"],
      "record-bookmark-evidence": [
        "type",
        "operation",
        "statusId",
        "xAccountId",
        "outcome",
        "observedAt",
        "token",
      ],
      "list-bookmark-evidence": ["type", "operation", "statusId"],
      "count-folder": ["type", "operation", "folderId"],
      counts: ["type", "operation"],
      "read-folder-page": ["type", "operation", "folderId", "limit", "cursor"],
    };
    for (const operation of COLLECTIONS_OPERATIONS) {
      expect(Object.keys(VALID[operation]).toSorted(), operation).toEqual(
        expected[operation].toSorted(),
      );
    }
  });
});

/** Points chrome.runtime.sendMessage at one canned worker answer. */
const send = (response: unknown): void => {
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn().mockResolvedValue(response) },
  } as unknown as typeof chrome;
};

describe("collections response validation", () => {
  afterEach(() => {
    globalThis.chrome = { storage: globalThis.chrome?.storage } as unknown as typeof chrome;
  });

  it("refuses to submit a request that does not validate", async () => {
    send({ ok: true });
    await expect(
      requestCollections({
        type: TYPE,
        operation: "create-folder",
      } as unknown as CollectionsRequest),
    ).rejects.toThrow("Invalid collections request");
  });

  it("surfaces an ok:false error string", async () => {
    send({ ok: false, error: "collections database unavailable" });
    await expect(requestCollections(VALID.counts)).rejects.toThrow(
      "collections database unavailable",
    );
  });

  it("rejects a malformed envelope and an empty error", async () => {
    send(null);
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
    send({ ok: false });
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
    send({ ok: false, error: "" });
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
  });

  it("returns a well-formed success", async () => {
    send({ ok: true, counts: { folders: 2, savedPosts: 9 } });
    await expect(requestCollections(VALID.counts)).resolves.toEqual({
      ok: true,
      counts: { folders: 2, savedPosts: 9 },
    });
  });

  it("throws on an extra-keyed, missing or wrongly-typed success", async () => {
    send({ ok: true, counts: { folders: 2, savedPosts: 9 }, extra: 1 });
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
    send({ ok: true });
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
    send({ ok: true, counts: { folders: "2", savedPosts: 9 } });
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
    send({ ok: true, counts: { folders: MAX_LIVE_FOLDERS + 1, savedPosts: 0 } });
    await expect(requestCollections(VALID.counts)).rejects.toThrow("Invalid collections response");
  });

  it("validates every read's own payload shape", async () => {
    const folder = {
      folderId: FOLDER,
      name: "Research",
      sortIndex: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    };
    send({ ok: true, folders: [folder] });
    await expect(requestCollections(VALID["list-folders"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, folders: [{ ...folder, ownerUserId: "9" }] });
    await expect(requestCollections(VALID["list-folders"])).rejects.toThrow(
      "Invalid collections response",
    );

    send({ ok: true, token: TOKEN });
    await expect(requestCollections(VALID.begin)).resolves.toMatchObject({ ok: true });
    send({ ok: true, token: { epoch: "nope", sequence: 1 } });
    await expect(requestCollections(VALID.begin)).rejects.toThrow("Invalid collections response");

    send({ ok: true, folderIds: [FOLDER] });
    await expect(requestCollections(VALID["folders-holding"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, folderIds: ["nope"] });
    await expect(requestCollections(VALID["folders-holding"])).rejects.toThrow(
      "Invalid collections response",
    );

    send({ ok: true, folder });
    await expect(requestCollections(VALID["create-folder"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, folder: { ...folder, deletedAt: 5 } });
    await expect(requestCollections(VALID["create-folder"])).resolves.toMatchObject({ ok: true });
    for (const broken of [
      "not-a-record",
      { ...folder, name: rest(MAX_FOLDER_NAME + 1) },
      { ...folder, sortIndex: -1 },
      { ...folder, createdAt: "1" },
      { ...folder, updatedAt: 1.5 },
      { ...folder, deletedAt: "yesterday" },
    ]) {
      send({ ok: true, folder: broken });
      await expect(requestCollections(VALID["create-folder"])).rejects.toThrow(
        "Invalid collections response",
      );
    }

    send({ ok: true, outcome: { status: "already-there", statusId: STATUS } });
    await expect(requestCollections(VALID["save-post"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, outcome: { status: "unsavable" } });
    await expect(requestCollections(VALID["save-post"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, outcome: { status: "saved" } });
    await expect(requestCollections(VALID["save-post"])).rejects.toThrow(
      "Invalid collections response",
    );

    const post = { ...capture, capturedAt: 5, note: "", tags: [] };
    send({ ok: true, post });
    await expect(requestCollections(VALID["get-saved-post"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, post: null });
    await expect(requestCollections(VALID["get-saved-post"])).resolves.toMatchObject({ ok: true });
    send({ ok: true, post: { ...post, xAccountId: "9" } });
    await expect(requestCollections(VALID["get-saved-post"])).rejects.toThrow(
      "Invalid collections response",
    );
    send({ ok: true, post: { ...post, tags: [rest(MAX_TAG + 1)] } });
    await expect(requestCollections(VALID["get-saved-post"])).rejects.toThrow(
      "Invalid collections response",
    );
    send({ ok: true, post: { ...post, capturedAt: -1 } });
    await expect(requestCollections(VALID["get-saved-post"])).rejects.toThrow(
      "Invalid collections response",
    );

    send({
      ok: true,
      evidence: [{ statusId: STATUS, xAccountId: "a", outcome: "confirmed", observedAt: 1 }],
    });
    await expect(requestCollections(VALID["list-bookmark-evidence"])).resolves.toMatchObject({
      ok: true,
    });
    send({ ok: true, evidence: [{ statusId: STATUS, outcome: "confirmed", observedAt: 1 }] });
    await expect(requestCollections(VALID["list-bookmark-evidence"])).rejects.toThrow(
      "Invalid collections response",
    );

    send({ ok: true, count: 3 });
    await expect(requestCollections(VALID["count-folder"])).resolves.toMatchObject({ ok: true });

    send({ ok: true, page: { posts: [post], nextCursor: "5:1" } });
    await expect(requestCollections(VALID["read-folder-page"])).resolves.toMatchObject({
      ok: true,
    });
    for (const broken of [
      "not-a-record",
      { posts: [], nextCursor: null, extra: 1 },
      { posts: ["not-a-post"], nextCursor: null },
      { posts: [], nextCursor: rest(MAX_CURSOR + 1) },
    ]) {
      send({ ok: true, page: broken });
      await expect(requestCollections(VALID["read-folder-page"])).rejects.toThrow(
        "Invalid collections response",
      );
    }
    // A page may never exceed the limit the caller asked for.
    send({
      ok: true,
      page: { posts: Array.from({ length: 26 }, () => post), nextCursor: null },
    });
    await expect(requestCollections(VALID["read-folder-page"])).rejects.toThrow(
      "Invalid collections response",
    );
  });

  it("lets a write answer with an acknowledgement and nothing more", async () => {
    send({ ok: true });
    await expect(requestCollections(VALID["set-note"])).resolves.toEqual({ ok: true });
    send({ ok: true, post: null });
    await expect(requestCollections(VALID["set-note"])).rejects.toThrow(
      "Invalid collections response",
    );
  });
});
