import { describe, expect, it } from "vitest";

import {
  createMessageSenderClassifier,
  type RuntimeMessageSender,
  type SenderRuntime,
} from "@/background/message-sender";

const runtime = (overrides: Partial<SenderRuntime> = {}): SenderRuntime => ({
  id: "lasso-id",
  getURL: (path) => new URL(path, "chrome-extension://lasso-id/").href,
  getManifest: () => ({
    options_ui: { page: "src/options/index.html" },
    action: { default_popup: "src/popup/index.html" },
  }),
  ...overrides,
});

const classify = createMessageSenderClassifier(runtime());

const xContent = (overrides: Partial<RuntimeMessageSender> = {}): RuntimeMessageSender => ({
  id: "lasso-id",
  tab: { id: 7 },
  frameId: 0,
  origin: "https://x.com",
  url: "https://x.com/home",
  ...overrides,
});

describe("createMessageSenderClassifier", () => {
  it("classifies exact Options and popup routes", () => {
    expect(
      classify({ id: "lasso-id", url: "chrome-extension://lasso-id/src/options/index.html" }),
    ).toBe("options");
    expect(
      classify({ id: "lasso-id", url: "chrome-extension://lasso-id/src/popup/index.html" }),
    ).toBe("popup");
  });

  it("rejects lookalike extension routes and missing or foreign extension ids", () => {
    expect(
      classify({ id: "lasso-id", url: "chrome-extension://lasso-id/src/options/index.html/evil" }),
    ).toBe("unknown");
    expect(classify({ url: "chrome-extension://lasso-id/src/options/index.html" })).toBe("unknown");
    expect(
      classify({ id: "other-id", url: "chrome-extension://lasso-id/src/options/index.html" }),
    ).toBe("unknown");
  });

  it("classifies only a same-origin top-frame x.com content sender", () => {
    expect(classify(xContent())).toBe("x-content");
  });

  it.each([
    ["missing tab", xContent({ tab: undefined })],
    ["missing tab id", xContent({ tab: {} })],
    ["child frame", xContent({ frameId: 1 })],
    ["wrong origin", xContent({ origin: "https://evil.example" })],
    ["opaque origin", xContent({ origin: "null" })],
    ["wrong URL origin", xContent({ url: "https://evil.example/home" })],
    ["malformed URL", xContent({ url: "://not-a-url" })],
    ["wrong id", xContent({ id: "other-id" })],
  ])("fails closed for %s", (_label, sender) => {
    expect(classify(sender)).toBe("unknown");
  });

  it("fails closed when a manifest route is absent or escapes the extension origin", () => {
    const withoutPopup = createMessageSenderClassifier(
      runtime({ getManifest: () => ({ options_ui: { page: "data:text/html,options" } }) }),
    );

    expect(
      withoutPopup({ id: "lasso-id", url: "chrome-extension://lasso-id/src/popup/index.html" }),
    ).toBe("unknown");
    expect(withoutPopup({ id: "lasso-id", url: "data:text/html,options" })).toBe("unknown");
  });

  it("fails closed when the runtime cannot build its extension origin", () => {
    const classifier = createMessageSenderClassifier(runtime({ getURL: () => "not a URL" }));

    expect(
      classifier({ id: "lasso-id", url: "chrome-extension://lasso-id/src/options/index.html" }),
    ).toBe("unknown");
  });
});
