import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isClearDataRequest,
  isGraphqlCatalogRequest,
  isListCacheRequest,
  isListUsageRequest,
  isMirrorStatusRequest,
  isSettingsRequest,
  decodeSettingsPatch,
  isStorageChangedMessage,
  requestCoach,
  requestFilterCommand,
  requestFilterRead,
  requestGraphqlCatalog,
  requestLassoDataClear,
  requestListCache,
  requestListUsage,
  requestMirrorStatus,
  requestSettingsPatch,
  requestSettingsRead,
} from "@/core/protocol";
import { DEFAULT_SETTINGS } from "@/core/settings-domain";

const owner = { userId: "1", screenName: "owner" };
const token = { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 };
const list = { id: "2", name: "Reading", memberCount: 1, isPrivate: false };
const catalog = {
  ListAddMember: { queryId: "add", features: {} },
  ListRemoveMember: { queryId: "remove", features: {} },
  UserByScreenName: { queryId: "user", features: {} },
};
const settings = {
  ...DEFAULT_SETTINGS,
  defaultList: { ownerUserId: "1", listId: "2" },
  defaultListId: "2",
  convexUrl: "https://mirror.test",
  convexDeviceKey: "key",
  mirrorConfigId: "config",
};
const originalChrome = globalThis.chrome;

const installRuntime = (response: unknown) => {
  const sendMessage = vi.fn().mockResolvedValue(response);
  globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
  return sendMessage;
};
const settingsRequest = (patch: object) =>
  isSettingsRequest({ type: "lasso:settings", operation: "patch", patch });

afterEach(() => {
  globalThis.chrome = originalChrome;
  vi.restoreAllMocks();
});

describe("tab protocol failures", () => {
  it("accepts only the exact clear request", () => {
    expect(isClearDataRequest({ type: "lasso:clear-data" })).toBe(true);
    for (const value of [null, [], {}, { type: "other" }]) {
      expect(isClearDataRequest(value)).toBe(false);
    }
  });

  it("checks clear-data response fields and preserves Chrome rejections", async () => {
    installRuntime({ localCleared: true, syncCleared: false });
    await expect(requestLassoDataClear()).resolves.toEqual({
      localCleared: true,
      syncCleared: false,
    });

    for (const response of [
      null,
      {},
      { localCleared: true },
      { syncCleared: true },
      { localCleared: 1, syncCleared: false },
      { localCleared: false, syncCleared: 1 },
    ]) {
      installRuntime(response);
      await expect(requestLassoDataClear()).rejects.toThrow("Invalid clear-data response");
    }
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockRejectedValue(new Error("lastError: no receiver")) },
    } as unknown as typeof chrome;
    await expect(requestLassoDataClear()).rejects.toThrow("lastError: no receiver");
  });
});

describe("storage event guard", () => {
  it("accepts the three known keys and fails closed", () => {
    for (const value of [
      {
        type: "lasso:storage-changed",
        area: "local",
        key: "lasso:settings",
        oldValue: 1,
        newValue: 2,
      },
      {
        type: "lasso:storage-changed",
        area: "local",
        key: "lasso:mirror-status",
        oldValue: 1,
        newValue: 2,
      },
      {
        type: "lasso:storage-changed",
        area: "sync",
        key: "lasso:filter",
        oldValue: 1,
        newValue: 2,
      },
    ]) {
      expect(isStorageChangedMessage(value)).toBe(true);
    }
    for (const value of [
      null,
      {},
      {
        type: "lasso:storage-changed",
        area: "local",
        key: "lasso:filter",
        oldValue: 1,
        newValue: 2,
      },
      {
        type: "lasso:storage-changed",
        area: "session",
        key: "lasso:settings",
        oldValue: 1,
        newValue: 2,
      },
      { type: "lasso:storage-changed", area: "local", key: 1, oldValue: 1, newValue: 2 },
      { type: "lasso:storage-changed", area: "local", key: "lasso:settings", newValue: 2 },
      { type: "lasso:storage-changed", area: "local", key: "lasso:settings", oldValue: 1 },
    ]) {
      expect(isStorageChangedMessage(value)).toBe(false);
    }
  });
});

describe("coach request wrapper", () => {
  it("accepts each matching result and rejects every response envelope failure", async () => {
    const sendMessage = installRuntime({
      ok: true,
      result: { kind: "is-onboarded", onboarded: true },
    });
    await expect(requestCoach({ kind: "is-onboarded" })).resolves.toEqual({
      kind: "is-onboarded",
      onboarded: true,
    });
    sendMessage.mockResolvedValueOnce({
      ok: true,
      result: { kind: "hints-active", active: false },
    });
    await expect(requestCoach({ kind: "hints-active" })).resolves.toEqual({
      kind: "hints-active",
      active: false,
    });
    sendMessage.mockResolvedValueOnce({ ok: true, result: { kind: "try-show-tip", show: true } });
    await expect(requestCoach({ kind: "try-show-tip", tip: "unit", max: 2 })).resolves.toEqual({
      kind: "try-show-tip",
      show: true,
    });
    sendMessage.mockResolvedValueOnce({ ok: true, result: { kind: "ok" } });
    await expect(requestCoach({ kind: "mark-onboarded" })).resolves.toEqual({ kind: "ok" });

    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, result: { kind: "ok", extra: true } },
      { ok: true, result: null },
    ]) {
      installRuntime(response);
      await expect(requestCoach({ kind: "record-assign" })).rejects.toThrow(
        response && "error" in response ? "denied" : "Invalid coach response",
      );
    }
    await expect(
      requestCoach({ kind: "try-show-tip", tip: "unit", max: 4 } as never),
    ).rejects.toThrow("Invalid coach command");
  });
});

describe("filter request wrapper", () => {
  const state = {
    enabled: true,
    criteria: {},
    onlyMyLanguages: false,
    myLanguages: ["en"],
    linkRules: [],
    presets: [],
    compactHidden: false,
    scopeBindings: {},
  };

  it("copies defaults, validates responses, and carries transport rejection", async () => {
    const sendMessage = installRuntime({ ok: true, state });
    await expect(requestFilterRead(["en"])).resolves.toEqual(state);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "lasso:filter",
      operation: "read",
      defaultLanguages: ["en"],
    });
    sendMessage.mockResolvedValueOnce({ ok: true, state });
    await expect(requestFilterCommand({ type: "set-enabled", on: false }, ["en"])).resolves.toEqual(
      state,
    );
    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, state: {} },
    ]) {
      installRuntime(response);
      await expect(requestFilterRead(["en"])).rejects.toThrow(
        response && "error" in response ? "denied" : "Invalid filter response",
      );
    }
    await expect(requestFilterRead(Array(65).fill("en"))).rejects.toThrow(
      "Invalid filter defaults",
    );
    await expect(
      requestFilterCommand({ type: "cycle", id: "bad" } as never, ["en"]),
    ).rejects.toThrow("Invalid filter command");
  });
});

describe("settings request wrapper", () => {
  it("rejects request envelopes before they reach Chrome", () => {
    expect(isSettingsRequest(null)).toBe(false);
    expect(isSettingsRequest({ type: "lasso:settings", operation: "read", extra: true })).toBe(
      false,
    );
    expect(isSettingsRequest({ type: "lasso:settings", operation: "unknown" })).toBe(false);
    expect(isSettingsRequest({ type: "lasso:settings", operation: "patch" })).toBe(false);
  });

  it("checks every nested patch shape before Chrome", () => {
    expect(
      settingsRequest({
        backend: "dom",
        defaultList: { ownerUserId: "1", listId: "2" },
        defaultListId: "2",
        activation: "auto",
        highContrast: true,
        convexUrl: "https://mirror.test",
        convexDeviceKey: "key",
        surfaces: { pill: false, palette: true },
        pillPosition: { x: 0, y: 1 },
        paletteHotkey: "mod+p",
      }),
    ).toBe(true);
    expect(settingsRequest({ activation: "on-demand", highContrast: false })).toBe(true);
    expect(settingsRequest({ defaultList: null })).toBe(true);
    for (const patch of [
      { defaultList: {} },
      { defaultList: { ownerUserId: 1, listId: "2" } },
      { defaultList: { ownerUserId: " ", listId: "2" } },
      { defaultList: { ownerUserId: "x".repeat(257), listId: "2" } },
      { defaultList: { ownerUserId: "1", listId: 2 } },
      { defaultList: { ownerUserId: "1", listId: " " } },
      { defaultList: { ownerUserId: "1", listId: "x".repeat(257) } },
      { surfaces: null },
      { surfaces: { pill: "yes" } },
      { pillPosition: null },
      { pillPosition: { x: "1" } },
      { pillPosition: { x: -1 } },
      { pillPosition: { x: 1_000_001 } },
      { pillPosition: { y: "1" } },
      { pillPosition: { y: -1 } },
      { pillPosition: { y: 1_000_001 } },
    ]) {
      expect(settingsRequest(patch)).toBe(false);
    }
    expect(decodeSettingsPatch({ convexUrl: "https://mirror.test" })).toEqual({
      convexUrl: "https://mirror.test",
    });
  });

  it("accepts a full snapshot, rejects malformed envelopes, and rejects invalid patches", async () => {
    const sendMessage = installRuntime({ ok: true, settings });
    await expect(requestSettingsRead()).resolves.toEqual(settings);
    sendMessage.mockResolvedValueOnce({ ok: true, settings });
    await expect(requestSettingsPatch({ backend: "graphql" })).resolves.toEqual(settings);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "lasso:settings",
      operation: "patch",
      patch: { backend: "graphql" },
    });
    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, settings: { ...settings, surfaces: { pill: true } } },
      { ok: true, settings: { ...settings, unknown: true } },
    ]) {
      installRuntime(response);
      await expect(requestSettingsRead()).rejects.toThrow(
        response && "error" in response ? "denied" : "Invalid settings response",
      );
    }
    await expect(requestSettingsPatch({ paletteHotkey: " " })).rejects.toThrow(
      "Invalid settings patch",
    );
  });
});

describe("GraphQL catalog protocol", () => {
  it("guards every operation and validates successful response shapes", async () => {
    expect(isGraphqlCatalogRequest({ type: "lasso:graphql-catalog", operation: "read" })).toBe(
      true,
    );
    expect(isGraphqlCatalogRequest({ type: "lasso:graphql-catalog", operation: "begin" })).toBe(
      true,
    );
    expect(
      isGraphqlCatalogRequest({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token,
        catalog,
      }),
    ).toBe(true);
    for (const request of [
      null,
      {},
      { type: "lasso:graphql-catalog", operation: "read", extra: true },
      {
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: { ...token, sequence: -1 },
        catalog,
      },
      { type: "lasso:graphql-catalog", operation: "commit", token, catalog: {} },
    ]) {
      expect(isGraphqlCatalogRequest(request)).toBe(false);
    }
    await expect(
      requestGraphqlCatalog({ type: "lasso:graphql-catalog", operation: "commit" } as never),
    ).rejects.toThrow("Invalid GraphQL catalog request");
    installRuntime({ ok: true, token });
    await expect(
      requestGraphqlCatalog({ type: "lasso:graphql-catalog", operation: "begin" }),
    ).resolves.toEqual({ ok: true, token });
    installRuntime({ ok: true, entry: { catalog, fetchedAt: 1 } });
    await expect(
      requestGraphqlCatalog({ type: "lasso:graphql-catalog", operation: "read" }),
    ).resolves.toEqual({ ok: true, entry: { catalog, fetchedAt: 1 } });
    installRuntime({ ok: true, entry: null });
    await expect(
      requestGraphqlCatalog({ type: "lasso:graphql-catalog", operation: "commit", token, catalog }),
    ).resolves.toEqual({ ok: true, entry: null });
    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, token: {} },
      { ok: true, entry: { catalog, fetchedAt: -1 } },
    ]) {
      installRuntime(response);
      await expect(
        requestGraphqlCatalog({
          type: "lasso:graphql-catalog",
          operation: response && "token" in response ? "begin" : "read",
        }),
      ).rejects.toThrow(
        response && "error" in response ? "denied" : "Invalid GraphQL catalog response",
      );
    }
  });
});

describe("list cache and usage protocol", () => {
  it("guards requests and validates all cache response modes", async () => {
    for (const request of [
      { type: "lasso:list-cache", operation: "all" },
      { type: "lasso:list-cache", operation: "read", owner },
      { type: "lasso:list-cache", operation: "begin", owner },
      { type: "lasso:list-cache", operation: "commit", owner, token, lists: [list] },
    ])
      expect(isListCacheRequest(request)).toBe(true);
    for (const request of [
      null,
      { type: "lasso:list-cache", operation: "all", extra: true },
      { type: "lasso:list-cache", operation: "read", owner: { ...owner, userId: "0" } },
      { type: "lasso:list-cache", operation: "commit", owner, token: {}, lists: [] },
      {
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token,
        lists: [{ ...list, name: " " }],
      },
    ])
      expect(isListCacheRequest(request)).toBe(false);
    expect(
      isListCacheRequest({
        type: "lasso:list-cache",
        operation: "read",
        owner: { ...owner, screenName: "x".repeat(51) },
      }),
    ).toBe(false);
    installRuntime({ ok: true, catalogs: [{ owner, lists: [list] }] });
    await expect(requestListCache({ type: "lasso:list-cache", operation: "all" })).resolves.toEqual(
      { ok: true, catalogs: [{ owner, lists: [list] }] },
    );
    installRuntime({ ok: true, token });
    await expect(
      requestListCache({ type: "lasso:list-cache", operation: "begin", owner }),
    ).resolves.toEqual({ ok: true, token });
    installRuntime({ ok: true, token: {} });
    await expect(
      requestListCache({ type: "lasso:list-cache", operation: "begin", owner }),
    ).rejects.toThrow("Invalid list cache response");
    installRuntime({ ok: true, lists: null });
    await expect(
      requestListCache({ type: "lasso:list-cache", operation: "read", owner }),
    ).resolves.toEqual({ ok: true, lists: null });
    installRuntime({ ok: true, lists: [list] });
    await expect(
      requestListCache({
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token,
        lists: [list],
      }),
    ).resolves.toEqual({ ok: true, lists: [list] });
    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, catalogs: [{}] },
      { ok: true, lists: [{}] },
    ]) {
      installRuntime(response);
      await expect(
        requestListCache({ type: "lasso:list-cache", operation: "all" }),
      ).rejects.toThrow(response && "error" in response ? "denied" : "Invalid list cache response");
    }
    installRuntime({ ok: true, lists: [{}] });
    await expect(
      requestListCache({ type: "lasso:list-cache", operation: "read", owner }),
    ).rejects.toThrow("Invalid list cache response");
    await expect(
      requestListCache({ type: "lasso:list-cache", operation: "read" } as never),
    ).rejects.toThrow("Invalid list cache request");
  });

  it("guards usage requests and validates both response modes", async () => {
    expect(
      isListUsageRequest({
        type: "lasso:list-usage",
        operation: "record",
        ownerUserId: "1",
        listId: "2",
      }),
    ).toBe(true);
    expect(
      isListUsageRequest({
        type: "lasso:list-usage",
        operation: "recent",
        ownerUserId: "1",
        limit: 2,
      }),
    ).toBe(true);
    for (const request of [
      null,
      { type: "lasso:list-usage", operation: "record", ownerUserId: "0", listId: "2" },
      { type: "lasso:list-usage", operation: "record", ownerUserId: "1", listId: "2", extra: true },
      { type: "lasso:list-usage", operation: "recent", ownerUserId: "1", limit: 101 },
    ])
      expect(isListUsageRequest(request)).toBe(false);
    installRuntime({ ok: true });
    await expect(
      requestListUsage({
        type: "lasso:list-usage",
        operation: "record",
        ownerUserId: "1",
        listId: "2",
      }),
    ).resolves.toEqual({ ok: true });
    installRuntime({ ok: true, listIds: ["2"] });
    await expect(
      requestListUsage({
        type: "lasso:list-usage",
        operation: "recent",
        ownerUserId: "1",
        limit: 2,
      }),
    ).resolves.toEqual({ ok: true, listIds: ["2"] });
    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, listIds: ["0"] },
    ]) {
      installRuntime(response);
      await expect(
        requestListUsage({
          type: "lasso:list-usage",
          operation: "recent",
          ownerUserId: "1",
          limit: 2,
        }),
      ).rejects.toThrow(response && "error" in response ? "denied" : "Invalid list usage response");
    }
    await expect(
      requestListUsage({ type: "lasso:list-usage", operation: "record" } as never),
    ).rejects.toThrow("Invalid list usage request");
  });
});

describe("mirror status protocol", () => {
  it("guards both operations and validates success or error envelopes", async () => {
    expect(isMirrorStatusRequest({ type: "lasso:mirror-status", operation: "read" })).toBe(true);
    expect(
      isMirrorStatusRequest({
        type: "lasso:mirror-status",
        operation: "report",
        ok: false,
        configId: "config",
      }),
    ).toBe(true);
    for (const request of [
      null,
      { type: "lasso:mirror-status", operation: "read", extra: true },
      { type: "lasso:mirror-status", operation: "report", ok: "yes", configId: "config" },
      { type: "lasso:mirror-status", operation: "report", ok: true, configId: " " },
      {
        type: "lasso:mirror-status",
        operation: "report",
        ok: true,
        configId: "x".repeat(257),
      },
    ])
      expect(isMirrorStatusRequest(request)).toBe(false);
    installRuntime({ ok: true, status: { ok: true, at: 1, configId: "config" } });
    await expect(
      requestMirrorStatus({ type: "lasso:mirror-status", operation: "read" }),
    ).resolves.toEqual({ ok: true, status: { ok: true, at: 1, configId: "config" } });
    installRuntime({ ok: true });
    await expect(
      requestMirrorStatus({
        type: "lasso:mirror-status",
        operation: "report",
        ok: true,
        configId: "config",
      }),
    ).resolves.toEqual({ ok: true });
    for (const response of [
      null,
      { ok: "yes" },
      { ok: false },
      { ok: false, error: "denied" },
      { ok: true, status: { ok: true, at: -1, configId: "config" } },
    ]) {
      installRuntime(response);
      await expect(
        requestMirrorStatus({ type: "lasso:mirror-status", operation: "read" }),
      ).rejects.toThrow(
        response && "error" in response ? "denied" : "Invalid mirror status response",
      );
    }
    await expect(
      requestMirrorStatus({ type: "lasso:mirror-status", operation: "report" } as never),
    ).rejects.toThrow("Invalid mirror status request");
  });
});

describe("Chrome transport failures", () => {
  it("propagates Chrome lastError rejections from every request wrapper", async () => {
    globalThis.chrome = {
      runtime: { sendMessage: vi.fn().mockRejectedValue(new Error("lastError: no receiver")) },
    } as unknown as typeof chrome;
    const requests = [
      requestCoach({ kind: "is-onboarded" }),
      requestFilterRead(["en"]),
      requestFilterCommand({ type: "set-enabled", on: true }, ["en"]),
      requestSettingsRead(),
      requestSettingsPatch({ backend: "dom" }),
      requestGraphqlCatalog({ type: "lasso:graphql-catalog", operation: "read" }),
      requestListCache({ type: "lasso:list-cache", operation: "all" }),
      requestListUsage({
        type: "lasso:list-usage",
        operation: "record",
        ownerUserId: "1",
        listId: "2",
      }),
      requestMirrorStatus({ type: "lasso:mirror-status", operation: "read" }),
    ];
    for (const request of requests) {
      await expect(request).rejects.toThrow("lastError: no receiver");
    }
  });
});
