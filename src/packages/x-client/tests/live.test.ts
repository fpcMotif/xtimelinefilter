import { describe, expect, it, vi } from "vitest";

import type { LassoSettings, SettingsStore } from "@/core/settings";
import { DomXListApi } from "@/packages/x-client/dom-api";
import type { PageDriver } from "@/packages/x-client/dom-page-driver";
import { GraphqlXListApi } from "@/packages/x-client/graphql-api";
import { createLiveXListApi } from "@/packages/x-client/live";
import { RestXListApi } from "@/packages/x-client/rest-api";

function settings() {
  const listeners = new Set<(next: LassoSettings) => void>();
  return {
    emit(next: Partial<LassoSettings>) {
      for (const listener of listeners) listener(next as LassoSettings);
    },
    store: {
      subscribe(listener: (next: LassoSettings) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies Pick<SettingsStore, "subscribe">,
  };
}

function runtime() {
  const driver: PageDriver = {
    openListsDialog: async () => {},
    isChecked: async () => false,
    toggleList: async () => {},
    commit: async () => "immediate",
    close: async () => {},
  };
  return {
    fetch: vi.fn() as unknown as typeof fetch,
    credentials: vi.fn(() => ({ csrf: "c", bearer: "b" })),
    createPageDriver: vi.fn(() => driver),
  };
}

describe("createLiveXListApi", () => {
  it("switches only when backend changes and ignores unrelated settings", () => {
    const s = settings();
    const live = createLiveXListApi("rest", s.store, runtime());
    const rest = live.snapshot();

    s.emit({ backend: "rest", highContrast: true });
    expect(live.snapshot()).toBe(rest);

    s.emit({ backend: "graphql" });
    expect(live.snapshot()).toBeInstanceOf(GraphqlXListApi);
    expect(live.snapshot()).not.toBe(rest);

    s.emit({ backend: "dom" });
    expect(live.snapshot()).toBeInstanceOf(DomXListApi);
    expect(rest).toBeInstanceOf(RestXListApi);
  });

  it("keeps the latest subscribed backend even when subscribe emits immediately", () => {
    const immediate = {
      subscribe(listener: (next: LassoSettings) => void) {
        listener({ backend: "graphql" } as LassoSettings);
        return () => {};
      },
    } satisfies Pick<SettingsStore, "subscribe">;

    expect(createLiveXListApi("rest", immediate, runtime()).snapshot()).toBeInstanceOf(
      GraphqlXListApi,
    );
  });

  it("stops a stale listener after disposal", () => {
    let listener: ((next: LassoSettings) => void) | undefined;
    const unsubscribe = vi.fn();
    const store = {
      subscribe(next: (value: LassoSettings) => void) {
        listener = next;
        return unsubscribe;
      },
    } satisfies Pick<SettingsStore, "subscribe">;
    const live = createLiveXListApi("rest", store, runtime());
    const rest = live.snapshot();

    live.dispose();
    live.dispose();
    listener!({ backend: "graphql" } as LassoSettings);

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(live.snapshot()).toBe(rest);
  });
});
