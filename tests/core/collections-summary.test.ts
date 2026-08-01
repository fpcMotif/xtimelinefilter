import { afterEach, describe, expect, it, vi } from "vitest";

import { readSavedSummary } from "@/core/collections-summary";
import * as collectionsProtocol from "@/core/protocol/collections";

afterEach(() => {
  globalThis.chrome = { storage: globalThis.chrome?.storage } as unknown as typeof chrome;
});

describe("readSavedSummary — the popup's entire collections grant (ADR-0013)", () => {
  it("resolves the account-free counts summary", async () => {
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
      expect(message).toEqual({ type: "lasso:collections", operation: "counts" });
      return { ok: true, counts: { folders: 3, savedPosts: 12 } };
    });
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    await expect(readSavedSummary()).resolves.toEqual({ folders: 3, savedPosts: 12 });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("fails soft to null when the worker answers ok:false", async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: "Folders unavailable" }));
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    await expect(readSavedSummary()).resolves.toBeNull();
  });

  it("fails soft to null when the transport throws before returning a promise", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage: () => {
          throw new Error("Extension context invalidated");
        },
      },
    } as unknown as typeof chrome;

    await expect(readSavedSummary()).resolves.toBeNull();
  });

  it("fails soft to null on a shape this operation's validator would never let through", async () => {
    // requestCollections re-validates every response, so a real worker can never
    // produce this — mocked at the protocol boundary only to exercise the
    // reader's own defensive narrowing.
    vi.spyOn(collectionsProtocol, "requestCollections").mockResolvedValueOnce({
      ok: true,
    } as never);

    await expect(readSavedSummary()).resolves.toBeNull();
  });
});
