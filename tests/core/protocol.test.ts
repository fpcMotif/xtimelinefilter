import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isContentToBackgroundMessage,
  isPopupToContentMessage,
  PAGE_ACTIVATE_CHANNEL,
  PAGE_ACTIVATE_READY,
  PAGE_ACTIVATE_REQUEST,
  PAGE_ACTIVATE_RESPONSE,
  PAGE_ACTIVATE_TARGET,
  sendToBackground,
  sendToTab,
} from "@/core/protocol";

// tests/setup.ts only fakes chrome.storage — runtime/tabs stubs are local to
// this file (house pattern: tests/background/index.test.ts, tests/popup/main.test.ts).
let previousChrome: unknown;

beforeEach(() => {
  previousChrome = globalThis.chrome;
});

afterEach(() => {
  globalThis.chrome = previousChrome as typeof chrome;
  vi.restoreAllMocks();
});

describe("content → background guard", () => {
  it("rejects an object with no type field", () => {
    expect(isContentToBackgroundMessage({})).toBe(false);
  });

  it("accepts a valid badge message", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:badge", count: 3 })).toBe(true);
  });

  it("rejects a badge message whose count is not a number", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:badge", count: "3" })).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unsafe badge count: %s",
    (count) => {
      expect(isContentToBackgroundMessage({ type: "lasso:badge", count })).toBe(false);
    },
  );

  it("accepts a valid awake state message", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:state", state: "awake" })).toBe(true);
  });

  it("accepts a valid asleep state message", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:state", state: "asleep" })).toBe(true);
  });

  it("rejects a state message with an unrecognized state value", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:state", state: "dozing" })).toBe(false);
  });

  it("rejects popup messages", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:status" })).toBe(false);
    expect(isContentToBackgroundMessage({ type: "lasso-activate" })).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(isContentToBackgroundMessage({ type: "lasso:unknown" })).toBe(false);
  });
});

describe("popup → content guard", () => {
  it("accepts popup requests", () => {
    expect(isPopupToContentMessage({ type: "lasso:status" })).toBe(true);
    expect(isPopupToContentMessage({ type: "lasso-activate" })).toBe(true);
  });

  it("rejects content messages", () => {
    expect(isPopupToContentMessage({ type: "lasso:badge", count: 3 })).toBe(false);
    expect(isPopupToContentMessage({ type: "lasso:state", state: "awake" })).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(isPopupToContentMessage("lasso:badge")).toBe(false);
  });

  it("rejects null", () => {
    expect(isPopupToContentMessage(null)).toBe(false);
  });

  it("rejects an object with no type field", () => {
    expect(isPopupToContentMessage({ count: 3 })).toBe(false);
  });
});

describe("sendToBackground", () => {
  it("delivers the message via chrome.runtime.sendMessage", () => {
    const sendMessage = vi.fn(() => Promise.resolve());
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    sendToBackground({ type: "lasso:badge", count: 5 });

    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:badge", count: 5 });
  });

  it("swallows a rejected sendMessage promise", async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error("no receiver")));
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    expect(() => sendToBackground({ type: "lasso:state", state: "awake" })).not.toThrow();
    // let the swallowed rejection's microtask settle before the test ends.
    await Promise.resolve();
    await Promise.resolve();
  });

  it("swallows a synchronous throw from sendMessage (dead extension context)", () => {
    const sendMessage = vi.fn(() => {
      throw new Error("Extension context invalidated.");
    });
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    expect(() => sendToBackground({ type: "lasso:state", state: "awake" })).not.toThrow();
  });

  it("is a no-op when chrome.runtime is absent", () => {
    globalThis.chrome = {} as unknown as typeof chrome;

    expect(() => sendToBackground({ type: "lasso:state", state: "asleep" })).not.toThrow();
  });
});

describe("sendToTab", () => {
  it("delegates to chrome.tabs.sendMessage and returns its promise", async () => {
    const response = { awake: true };
    const sendMessage = vi.fn(() => Promise.resolve(response));
    globalThis.chrome = { tabs: { sendMessage } } as unknown as typeof chrome;

    const result = await sendToTab(42, { type: "lasso:status" });

    expect(sendMessage).toHaveBeenCalledWith(42, { type: "lasso:status" });
    expect(result).toBe(response);
  });
});

describe("frozen wire format constants", () => {
  it("pins the exact string values", () => {
    expect(PAGE_ACTIVATE_CHANNEL).toBe("__lasso_x_main_world_activate__");
    expect(PAGE_ACTIVATE_REQUEST).toBe("activate");
    expect(PAGE_ACTIVATE_RESPONSE).toBe("activated");
    expect(PAGE_ACTIVATE_READY).toBe("data-lasso-main-world-activate");
    expect(PAGE_ACTIVATE_TARGET).toBe("data-lasso-activate-target");
  });
});
