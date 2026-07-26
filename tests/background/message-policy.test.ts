import { describe, expect, it } from "vitest";

import { canHandleMessage } from "@/background/message-policy";
import type { SenderCapability } from "@/background/message-sender";

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
  });

  it("gives the popup Filter read/commands, Settings read, and Mirror read", () => {
    allowed("popup", { type: "lasso:filter", operation: "read" });
    allowed("popup", { type: "lasso:filter", operation: "command" });
    allowed("popup", { type: "lasso:settings", operation: "read" });
    allowed("popup", { type: "lasso:mirror-status", operation: "read" });
    denied("popup", { type: "lasso:settings", operation: "patch", patch: {} });
    denied("popup", { type: "lasso:mirror-status", operation: "report" });
    denied("popup", { type: "lasso:list-cache", operation: "all" });
    denied("popup", { type: "lasso:clear-data" });
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
