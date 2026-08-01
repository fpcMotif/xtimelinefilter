import { describe, expect, it } from "vitest";

import { canHandleMessage } from "@/background/message-policy";
import type { SenderCapability } from "@/background/message-sender";
import { COLLECTIONS_OPERATIONS, type CollectionsOperation } from "@/core/protocol/collections";

const allowed = (capability: SenderCapability, message: unknown): void =>
  expect(canHandleMessage(capability, message)).toBe(true);

const denied = (capability: SenderCapability, message: unknown): void =>
  expect(canHandleMessage(capability, message)).toBe(false);

describe("runtime message capability policy", () => {
  it("gives Options full settings, Filter, replay, cache listing, and Privacy clear", () => {
    for (const message of [
      { type: "lasso:clear-data" },
      { type: "lasso:settings", operation: "read" },
      { type: "lasso:settings", operation: "patch", patch: { backend: "graphql" } },
      { type: "lasso:filter", operation: "read" },
      { type: "lasso:filter", operation: "command" },
      { type: "lasso:coach", command: { kind: "replay-intro" } },
      { type: "lasso:list-cache", operation: "all" },
    ]) {
      allowed("options", message);
    }

    denied("options", { type: "lasso:coach", command: { kind: "record-assign" } });
    denied("options", { type: "lasso:list-cache", operation: "commit" });
    denied("options", { type: "lasso:mirror-status", operation: "report" });
  });

  it("limits X content to its runtime domain commands and three settings fields", () => {
    for (const message of [
      { type: "lasso:settings", operation: "read" },
      {
        type: "lasso:settings",
        operation: "patch",
        patch: { defaultList: null, defaultListId: null, pillPosition: { x: 1 } },
      },
      { type: "lasso:filter", operation: "command" },
      { type: "lasso:coach", command: { kind: "try-show-tip" } },
      { type: "lasso:list-cache", operation: "begin" },
      { type: "lasso:list-usage", operation: "record" },
      { type: "lasso:mirror-status", operation: "report" },
      { type: "lasso:graphql-catalog", operation: "commit" },
      { type: "lasso:badge", count: 1 },
      { type: "lasso:state", state: "awake" },
    ]) {
      allowed("x-content", message);
    }

    denied("x-content", { type: "lasso:clear-data" });
    denied("x-content", {
      type: "lasso:settings",
      operation: "patch",
      patch: { backend: "graphql" },
    });
    denied("x-content", { type: "lasso:coach", command: { kind: "replay-intro" } });
    denied("x-content", { type: "lasso:list-cache", operation: "all" });
    // The page saves and browses Folders but renders no count: the popup's
    // summary read is refused here (ticket #74).
    denied("x-content", { type: "lasso:collections", operation: "counts" });
  });

  it("gives the popup Filter read/commands, Settings read, Mirror read, and the collections counts summary", () => {
    allowed("popup", { type: "lasso:filter", operation: "read" });
    allowed("popup", { type: "lasso:filter", operation: "command" });
    allowed("popup", { type: "lasso:settings", operation: "read" });
    allowed("popup", { type: "lasso:mirror-status", operation: "read" });
    allowed("popup", { type: "lasso:collections", operation: "counts" });
    denied("popup", { type: "lasso:settings", operation: "patch", patch: {} });
    denied("popup", { type: "lasso:mirror-status", operation: "report" });
    denied("popup", { type: "lasso:list-cache", operation: "all" });
    denied("popup", { type: "lasso:clear-data" });
  });

  it("pins the popup's collections allow-list as an exact set: the counts summary and nothing else (ticket #74)", () => {
    // Walks every operation the family knows about, so an operation added later
    // (e.g. a Destination-seam `destination-status` or `sync-now`) must extend
    // this literal ON PURPOSE rather than being granted to the popup by
    // omission. #69 already scoped the family this way; this pins it here too,
    // beside the popup's other capabilities, per ticket #74.
    const POPUP_ALLOWED: readonly CollectionsOperation[] = ["counts"];
    for (const operation of COLLECTIONS_OPERATIONS) {
      const message = { type: "lasso:collections", operation };
      expect(canHandleMessage("popup", message), operation).toBe(POPUP_ALLOWED.includes(operation));
    }
  });

  it("pins x-content's collections allow-list as an exact set: the save gesture and its picker, nothing else (ticket #71)", () => {
    // Same walk as the popup's pin above. `delete-saved-post` completes the
    // Undo a Folder Picker save arms: its first leg (`remove-from-folder`) was
    // already granted, but the second (deleting a post THIS gesture minted)
    // was missing here, so the worker silently dropped it.
    const X_CONTENT_ALLOWED: readonly CollectionsOperation[] = [
      "begin",
      "list-folders",
      "folders-holding",
      "create-folder",
      "save-post",
      "save-to-default-folder",
      "remove-from-folder",
      "delete-saved-post",
    ];
    for (const operation of COLLECTIONS_OPERATIONS) {
      const message = { type: "lasso:collections", operation };
      expect(canHandleMessage("x-content", message), operation).toBe(
        X_CONTENT_ALLOWED.includes(operation),
      );
    }
  });
  it("limits social content to the Folder save surface", () => {
    const SOCIAL_ALLOWED: readonly CollectionsOperation[] = [
      "begin",
      "list-folders",
      "folders-holding",
      "create-folder",
      "save-post",
      "save-to-default-folder",
      "remove-from-folder",
      "delete-saved-post",
    ];
    for (const operation of COLLECTIONS_OPERATIONS) {
      const message = { type: "lasso:collections", operation };
      expect(canHandleMessage("social-content", message), operation).toBe(
        SOCIAL_ALLOWED.includes(operation),
      );
    }
    denied("social-content", { type: "lasso:settings", operation: "read" });
    denied("social-content", { type: "lasso:filter", operation: "read" });
  });

  it("fails closed for unknown senders, routes, operations, and malformed inputs", () => {
    for (const message of [
      null,
      [],
      {},
      { type: "unknown" },
      { type: "lasso:filter", operation: "erase" },
      { type: "lasso:settings", operation: "patch", patch: null },
    ]) {
      denied("unknown", message);
    }
  });

  it("rejects content patches and Coach commands without their required records", () => {
    denied("x-content", { type: "lasso:settings", operation: "patch", patch: null });
    denied("options", { type: "lasso:coach", command: null });
  });
});
