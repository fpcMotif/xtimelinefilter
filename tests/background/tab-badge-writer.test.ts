import { describe, expect, it, vi } from "vitest";

import { TabBadgeWriter, type TabBadgeWriterApi } from "@/background/tab-badge-writer";

function sender(documentId = "doc-a", frameId = 0) {
  return { tab: { id: 7 }, documentId, frameId };
}

function createHarness(currentDocumentId = "doc-a") {
  const currentTopDocumentId = vi.fn(async () => currentDocumentId);
  const write = vi.fn(async () => {});
  const api: TabBadgeWriterApi = { currentTopDocumentId, write };
  return { writer: new TabBadgeWriter(api), currentTopDocumentId, write };
}

describe("TabBadgeWriter", () => {
  it("publishes only from the current top document", async () => {
    const { writer, currentTopDocumentId, write } = createHarness();

    writer.publish(sender(), { text: "7", backgroundColor: "#1d9bf0" });

    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith(7, { text: "7", backgroundColor: "#1d9bf0" }),
    );
    expect(currentTopDocumentId).toHaveBeenCalledWith(7);
  });

  it("rejects a stale document, a subframe, and missing identity", async () => {
    const { writer, currentTopDocumentId, write } = createHarness("doc-current");

    writer.publish(sender("doc-old"), { text: "7" });
    writer.publish(sender("doc-current", 1), { text: "8" });
    writer.publish({ tab: { id: 7 }, frameId: 0 }, { text: "9" });
    writer.publish({ documentId: "doc-current", frameId: 0 }, { text: "10" });

    await vi.waitFor(() => expect(currentTopDocumentId).toHaveBeenCalledTimes(1));
    expect(write).not.toHaveBeenCalled();
  });

  it("clears after an old document publish that was queued before commit", async () => {
    const { writer, write } = createHarness();

    writer.publish(sender(), { text: "7" });
    writer.clear(7);

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenNthCalledWith(1, 7, { text: "7" });
    expect(write).toHaveBeenNthCalledWith(2, 7, { text: "" });
  });

  it("continues after a rejected probe or badge write", async () => {
    const currentTopDocumentId = vi.fn().mockRejectedValueOnce(new Error("tab gone"));
    const write = vi.fn().mockRejectedValueOnce(new Error("tab gone"));
    const writer = new TabBadgeWriter({ currentTopDocumentId, write });

    writer.publish(sender(), { text: "7" });
    writer.clear(7);
    writer.clear(7);

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenNthCalledWith(1, 7, { text: "" });
    expect(write).toHaveBeenNthCalledWith(2, 7, { text: "" });
  });
});
