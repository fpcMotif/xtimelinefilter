import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as protocol from "@/core/protocol";
import {
  decodeSettingsPatch,
  encodeSettingsPatch,
  isContentToBackgroundMessage,
  isCoachRequest,
  isFilterRequest,
  isPopupToContentMessage,
  isSettingsRequest,
  PAGE_ACTIVATE_CHANNEL,
  PAGE_ACTIVATE_READY,
  PAGE_ACTIVATE_REQUEST,
  PAGE_ACTIVATE_RESPONSE,
  PAGE_ACTIVATE_TARGET,
  sendToBackground,
  sendToTab,
  requestCoach,
  requestFilterCommand,
  requestFilterRead,
  requestGraphqlCatalog,
  requestListUsage,
  isGraphqlCatalogRequest,
} from "@/core/protocol";
import type {
  ActivateRequest,
  BadgeMessage,
  ClearDataRequest,
  ClearDataResponse,
  CoachRequest,
  CoachResponse,
  ContentToBackground,
  FilterRequest,
  FilterResponse,
  GraphqlCatalogRequest,
  GraphqlCatalogResponse,
  GraphqlCatalogSuccess,
  LassoStatusResponse,
  ListCacheRequest,
  ListCacheResponse,
  ListCacheSuccess,
  ListUsageRequest,
  ListUsageResponse,
  ListUsageSuccess,
  MirrorStatusRequest,
  MirrorStatusResponse,
  MirrorStatusSuccess,
  PopupToContent,
  SettingsRequest,
  SettingsResponse,
  SettingsWirePatch,
  StateMessage,
  StatusRequest,
  StorageChangedMessage,
} from "@/core/protocol";

type PublicProtocolTypes = [
  ActivateRequest,
  BadgeMessage,
  ClearDataRequest,
  ClearDataResponse,
  CoachRequest,
  CoachResponse,
  ContentToBackground,
  FilterRequest,
  FilterResponse,
  GraphqlCatalogRequest,
  GraphqlCatalogResponse,
  GraphqlCatalogSuccess,
  LassoStatusResponse,
  ListCacheRequest,
  ListCacheResponse,
  ListCacheSuccess,
  ListUsageRequest,
  ListUsageResponse,
  ListUsageSuccess,
  MirrorStatusRequest,
  MirrorStatusResponse,
  MirrorStatusSuccess,
  PopupToContent,
  SettingsRequest,
  SettingsResponse,
  SettingsWirePatch,
  StateMessage,
  StatusRequest,
  StorageChangedMessage,
];
void (undefined as PublicProtocolTypes | undefined);

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

describe("protocol facade", () => {
  it("exports the complete runtime contract", () => {
    expect(Object.keys(protocol).toSorted()).toEqual([
      "PAGE_ACTIVATE_CHANNEL",
      "PAGE_ACTIVATE_READY",
      "PAGE_ACTIVATE_REQUEST",
      "PAGE_ACTIVATE_RESPONSE",
      "PAGE_ACTIVATE_TARGET",
      "decodeSettingsPatch",
      "encodeSettingsPatch",
      "isClearDataRequest",
      "isCoachRequest",
      "isContentToBackgroundMessage",
      "isFilterRequest",
      "isGraphqlCatalogRequest",
      "isListCacheRequest",
      "isListUsageRequest",
      "isMirrorStatusRequest",
      "isPopupToContentMessage",
      "isSettingsRequest",
      "isStorageChangedMessage",
      "requestCoach",
      "requestFilterCommand",
      "requestFilterRead",
      "requestGraphqlCatalog",
      "requestLassoDataClear",
      "requestListCache",
      "requestListUsage",
      "requestMirrorStatus",
      "requestSettingsPatch",
      "requestSettingsRead",
      "sendToBackground",
      "sendToTab",
    ]);
  });
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

describe("worker Coach protocol", () => {
  it("accepts exact bounded commands and rejects snapshots or extras", () => {
    expect(
      isCoachRequest({
        type: "lasso:coach",
        command: { kind: "try-show-tip", tip: "unit", max: 3 },
      }),
    ).toBe(true);
    for (const request of [
      { type: "lasso:coach", command: { kind: "try-show-tip", tip: "unit", max: 4 } },
      { type: "lasso:coach", command: { kind: "mark-onboarded", extra: true } },
      { type: "lasso:coach", command: { onboarded: true } },
      { type: "lasso:coach", command: { kind: "record-assign" }, extra: true },
    ]) {
      expect(isCoachRequest(request)).toBe(false);
    }
  });

  it("accepts only the matching Coach result", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, result: { kind: "try-show-tip", show: true } })
      .mockResolvedValueOnce({ ok: true, result: { kind: "ok" } });
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    await expect(requestCoach({ kind: "try-show-tip", tip: "unit", max: 3 })).resolves.toEqual({
      kind: "try-show-tip",
      show: true,
    });
    await expect(requestCoach({ kind: "is-onboarded" })).rejects.toThrow("Invalid coach response");
  });
});

describe("worker settings protocol", () => {
  it("accepts known patches, including null wire clears", () => {
    expect(
      isSettingsRequest({
        type: "lasso:settings",
        operation: "patch",
        patch: {
          backend: "graphql",
          convexUrl: null,
          convexDeviceKey: null,
          surfaces: { palette: true },
          pillPosition: { x: 12 },
        },
      }),
    ).toBe(true);
  });

  it("rejects forged ids, unknown fields, nested extras, and undefined clears", () => {
    for (const patch of [
      { mirrorConfigId: "forged" },
      { unknown: true },
      { surfaces: { palette: true, extra: true } },
      { pillPosition: { x: 2, z: 3 } },
      { convexUrl: undefined },
    ]) {
      expect(isSettingsRequest({ type: "lasso:settings", operation: "patch", patch })).toBe(false);
    }
  });

  it("rejects empty and oversized settings strings before worker storage", () => {
    for (const patch of [
      { defaultList: { ownerUserId: "", listId: "1" } },
      { defaultListId: "x".repeat(257) },
      { defaultFolderId: "x".repeat(257) },
      { convexUrl: "x".repeat(2_049) },
      { convexDeviceKey: "x".repeat(4_097) },
      { paletteHotkey: "x".repeat(129) },
      { pillPosition: { x: 1e308 } },
      { pillPosition: { y: -1 } },
    ]) {
      expect(isSettingsRequest({ type: "lasso:settings", operation: "patch", patch })).toBe(false);
    }
  });

  it("encodes explicit TypeScript clears as null and restores them after validation", () => {
    const wire = encodeSettingsPatch({
      convexUrl: undefined,
      convexDeviceKey: undefined,
      defaultList: undefined,
      defaultListId: undefined,
    });
    expect(wire).toEqual({
      convexUrl: null,
      convexDeviceKey: null,
      defaultList: null,
      defaultListId: null,
    });
    expect(isSettingsRequest({ type: "lasso:settings", operation: "patch", patch: wire })).toBe(
      true,
    );
    const decoded = decodeSettingsPatch(wire);
    expect(Object.hasOwn(decoded, "convexUrl")).toBe(true);
    expect(decoded.convexUrl).toBeUndefined();
  });
});

describe("worker Filter protocol", () => {
  const defaults = ["en"];

  it("accepts bounded semantic commands and read requests", () => {
    expect(
      isFilterRequest({
        type: "lasso:filter",
        operation: "read",
        defaultLanguages: defaults,
      }),
    ).toBe(true);
    expect(
      isFilterRequest({
        type: "lasso:filter",
        operation: "command",
        defaultLanguages: defaults,
        command: { type: "cycle", id: "kind:video" },
      }),
    ).toBe(true);
  });

  it("rejects snapshots, unknown criteria, extras, and oversized defaults", () => {
    for (const request of [
      {
        type: "lasso:filter",
        operation: "command",
        defaultLanguages: defaults,
        command: { type: "cycle", id: "unknown" },
      },
      {
        type: "lasso:filter",
        operation: "command",
        defaultLanguages: defaults,
        command: { type: "set-enabled", on: true, extra: true },
      },
      { type: "lasso:filter", operation: "read", defaultLanguages: Array(65).fill("en") },
    ]) {
      expect(isFilterRequest(request)).toBe(false);
    }
  });

  it("validates returned Filter snapshots before exposing them", async () => {
    const valid = {
      enabled: true,
      criteria: { "kind:video": "only" },
      onlyMyLanguages: false,
      myLanguages: ["en"],
      linkRules: [],
      presets: [],
      compactHidden: false,
      scopeBindings: {},
    };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, state: valid })
      .mockResolvedValueOnce({ ok: true, state: { criteria: {} } });
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    await expect(requestFilterRead(defaults)).resolves.toEqual(valid);
    await expect(
      requestFilterCommand({ type: "cycle", id: "kind:video" }, defaults),
    ).rejects.toThrow("Invalid filter response");
  });
});

describe("GraphQL catalog protocol", () => {
  const catalog = {
    ListAddMember: { queryId: "add", features: {} },
    ListRemoveMember: { queryId: "remove", features: {} },
    UserByScreenName: { queryId: "user", features: {} },
  };

  it("uses the package contract to reject malformed commit envelopes", () => {
    expect(
      isGraphqlCatalogRequest({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 },
        catalog: { ...catalog, unexpected: {} },
      }),
    ).toBe(false);
  });

  it("validates a returned catalog through the same contract", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      entry: { catalog: { ...catalog, unexpected: {} }, fetchedAt: 1 },
    });
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;

    await expect(
      requestGraphqlCatalog({ type: "lasso:graphql-catalog", operation: "read" }),
    ).rejects.toThrow("Invalid GraphQL catalog response");
  });
});

describe("list-usage protocol", () => {
  it("rejects a recent response above the requested bound", async () => {
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true, listIds: ["1", "2"] }),
      },
    } as unknown as typeof chrome;

    await expect(
      requestListUsage({
        type: "lasso:list-usage",
        operation: "recent",
        ownerUserId: "1",
        limit: 1,
      }),
    ).rejects.toThrow("Invalid list usage response");
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
