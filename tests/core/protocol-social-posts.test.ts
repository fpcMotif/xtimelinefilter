import { describe, expect, it } from "vitest";

import { isCollectionsRequest } from "@/core/protocol/collections";

const token = {
  epoch: "00000000-0000-4000-8000-000000000001",
  sequence: 1,
};

const capture = (statusId: string) => ({
  statusId,
  permalink: "https://www.threads.com/@alice/post/AbC-123",
  author: { screenName: "alice" },
  text: "hello",
  media: [],
});

describe("Collections saved-post identities", () => {
  it("accepts platform-qualified Instagram and Threads captures while retaining X ids", () => {
    for (const statusId of ["123456789", "threads:AbC-123", "instagram:CODE_1"]) {
      expect(
        isCollectionsRequest({
          type: "lasso:collections",
          operation: "save-to-default-folder",
          capture: capture(statusId),
          token,
        }),
      ).toBe(true);
    }
  });

  it("rejects unqualified non-X identities", () => {
    expect(
      isCollectionsRequest({
        type: "lasso:collections",
        operation: "save-to-default-folder",
        capture: capture("raw-shortcode"),
        token,
      }),
    ).toBe(false);
  });
});
