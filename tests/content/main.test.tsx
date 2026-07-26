import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// main.tsx is the content boot path: it runs main() at import, wiring ~30
// collaborators together. We mock every collaborator, capture the closures they
// receive (the deps objects, scanner/keyboard/route callbacks, the rendered App
// and Overlay vnodes), then drive each one — the only honest way to cover an
// import-time entry point (unit-test-design.md §11). The hover/select-tap/overlay
// mechanics themselves live in their own dedicated suites (hover-tracker.test.ts,
// select-tap.test.ts, overlay-lifecycle.test.ts); here we only verify main.tsx
// wires the right deps into them.

type AnyFn = (...args: unknown[]) => unknown;
type Caps = {
  controllerDeps?: Record<string, AnyFn | Record<string, AnyFn> | unknown>;
  xPageOptions?: {
    initialBackend: unknown;
    settings: unknown;
    graphqlCache: unknown;
    dispatchSyntheticEscape(target: Document | Element): void;
    findAuthorCaret(screenName: string): Element | null;
  };
  listCacheLoader?: AnyFn;
  pickerDeps?: {
    currentOwner: AnyFn;
    membershipStore: unknown;
    recentIds: AnyFn;
    memberships: AnyFn;
  };
  scannerCb?: (article: Element) => void;
  scannerOpts?: { onScan?: AnyFn; onTweetRemoved?: (article: Element) => void };
  keyboardRun?: AnyFn;
  keyboardSurfaces?: { togglePalette: () => boolean; modalOpen: () => boolean };
  keyboardLayers?: Array<{
    keymap: Array<{ combo: string; command: string }>;
    run: AnyFn;
    dispose: ReturnType<typeof vi.fn>;
  }>;
  routeCb?: AnyFn;
  healthOnBreakage?: AnyFn;
  filterDeps?: {
    settings: unknown;
    highContrastHosts: unknown;
    scope: AnyFn;
  };
  highContrastListener?: (settings: { highContrast: boolean }) => void;
  settingsListeners?: AnyFn[];
  membershipArgs?: [unknown, unknown];
  onMessage?: (msg: unknown, sender: unknown, send: AnyFn) => void;
  shadowHost?: HTMLElement;
  selection?: {
    add: (author: { screenName: string }) => void;
    setSelectMode: (on: boolean) => void;
  };
  hoverDeps?: {
    resolve: (el: Element | null) => Element | null;
    onHover: (article: Element | null) => void;
    fallback: () => Element | null;
  };
  selectTapDeps?: {
    isActive: () => boolean;
    resolveTarget: (t: EventTarget | null) => Element | null;
    onToggle: (article: Element) => boolean | void;
  };
};

const H = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    config: {
      settings: {} as Record<string, unknown>,
      onboarded: false,
      stubbed: false,
      computedPosition: "static",
      shadowError: false,
    },
    cap: {} as Caps,
    fake: {
      controller: {
        command: vi.fn(),
        trySelectMode: vi.fn(),
        wake: vi.fn(),
        toggleSelect: vi.fn(),
        reportBreakage: vi.fn(),
      },
      filter: {
        classify: vi.fn(),
        isStubbed: vi.fn(),
        sync: vi.fn(),
        paletteHotkey: vi.fn(() => null),
        togglePalette: vi.fn(() => false),
        isPaletteOpen: vi.fn(() => false),
        dismiss: vi.fn(() => false),
        unmount: vi.fn(),
      },
      filterStore: { dispose: vi.fn() },
      installFilter: vi.fn(),
      coach: {
        isOnboarded: vi.fn(),
        tryShowTip: vi.fn(async () => false),
        hintsActive: vi.fn(async () => false),
      },
      settings: {
        get: vi.fn(),
        subscribe: vi.fn((cb) => {
          (H.cap.settingsListeners ??= []).push(cb);
          return () => H.fake.highContrastUnsubscribe();
        }),
      },
      caret: { notInterested: fn() },
      listCache: {},
      listUsage: { recentIds: vi.fn(() => []), record: vi.fn() },
      picker: {},
      membership: {},
      backend: {},
      xPage: {
        lists: { snapshot: vi.fn(() => ({})) },
        ownedLists: vi.fn(async () => []),
        membershipListIds: vi.fn(async () => []),
        mute: vi.fn(async () => {}),
        unmute: vi.fn(async () => {}),
        block: vi.fn(async () => {}),
        dispose: vi.fn(),
      },
      health: { record: vi.fn() },
      uiHost: {
        host: null as unknown as HTMLElement,
        render: vi.fn(),
        destroy: vi.fn(),
        root: null as unknown as HTMLElement,
      },
      scanner: { start: vi.fn(), stop: vi.fn() },
      hover: {
        targetTweet: vi.fn(() => null as Element | null),
        release: vi.fn(),
        dispose: vi.fn(),
      },
      overlays: {
        attach: vi.fn(),
        releaseFor: vi.fn(),
        disposeAll: vi.fn(),
      },
      mirrorStore: {
        publish: vi.fn(),
        read: vi.fn(),
      },
      selectTapDispose: vi.fn(),
      keyboardDispose: vi.fn(),
      routeDispose: vi.fn(),
      highContrastUnsubscribe: vi.fn(),
    },
    spy: {
      render: vi.fn(),
      getCurrentAccount: vi.fn(() => ({ userId: "1", screenName: "op" })),
      getFocusedTweet: vi.fn(() => null as Element | null),
      extractAuthor: vi.fn((_article: Element) => ({ screenName: "a" }) as unknown),
      isInScope: vi.fn(() => true),
      resolveScope: vi.fn(() => ({ kind: "home" }) as const),
      buildConvex: vi.fn(),
    },
  };
});

vi.mock("preact", async () => ({
  ...(await vi.importActual<typeof import("preact")>("preact")),
  render: H.spy.render,
}));
vi.mock("@/content/controller", () => ({
  createLassoController: (deps: Caps["controllerDeps"]) => {
    H.cap.controllerDeps = deps;
    return H.fake.controller;
  },
}));
vi.mock("@/content/filter-feature", () => ({
  installFilterFeature: (deps: Caps["filterDeps"]) => {
    H.cap.filterDeps = deps;
    return H.fake.installFilter();
  },
}));
vi.mock("@/core/filter-store", () => ({
  createFilterStore: () => H.fake.filterStore,
}));
vi.mock("@/content/get-current-account", () => ({
  getCurrentAccount: H.spy.getCurrentAccount,
}));
vi.mock("@/content/get-focused-tweet", () => ({
  getFocusedTweet: H.spy.getFocusedTweet,
}));
vi.mock("@/content/hover-tracker", () => ({
  installHoverTracker: (deps: Caps["hoverDeps"]) => {
    H.cap.hoverDeps = deps;
    return H.fake.hover;
  },
}));
vi.mock("@/content/keyboard", () => ({
  DEFAULT_KEYMAP: [{ combo: "s", command: "toggle-select-mode" }],
  installKeyboardLayer: (opts: {
    keymap: Array<{ combo: string; command: string }>;
    run: AnyFn;
    surfaces?: Caps["keyboardSurfaces"];
  }) => {
    const dispose = vi.fn(() => H.fake.keyboardDispose());
    (H.cap.keyboardLayers ??= []).push({
      keymap: opts.keymap,
      run: opts.run,
      dispose,
    });
    H.cap.keyboardRun = opts.run;
    H.cap.keyboardSurfaces = opts.surfaces;
    return dispose;
  },
}));
vi.mock("@/content/overlay-lifecycle", () => ({
  createOverlayLifecycle: () => H.fake.overlays,
}));
vi.mock("@/content/route", () => ({
  isInScope: H.spy.isInScope,
  resolveScope: H.spy.resolveScope,
  onRouteChange: (cb: AnyFn) => {
    H.cap.routeCb = cb;
    return H.fake.routeDispose;
  },
}));
vi.mock("@/content/scanner-health", () => ({
  createScannerHealth: (opts: { onBreakage: AnyFn }) => {
    H.cap.healthOnBreakage = opts.onBreakage;
    return H.fake.health;
  },
}));
vi.mock("@/content/select-tap", () => ({
  installSelectTap: (deps: Caps["selectTapDeps"]) => {
    H.cap.selectTapDeps = deps;
    return H.fake.selectTapDispose;
  },
}));
vi.mock("@/content/tweet-scanner", () => ({
  createTweetScanner: (_doc: unknown, cb: Caps["scannerCb"], opts: Caps["scannerOpts"]) => {
    H.cap.scannerCb = cb;
    H.cap.scannerOpts = opts;
    return H.fake.scanner;
  },
}));
vi.mock("@/core/coach", () => ({ createCoach: () => H.fake.coach }));
vi.mock("@/core/keycaps", () => ({ detectPlatform: () => "mac" }));
vi.mock("@/core/list-cache", () => ({
  createListCache: (loader: AnyFn) => {
    H.cap.listCacheLoader = loader;
    return H.fake.listCache;
  },
}));
vi.mock("@/core/list-usage", () => ({
  createListUsage: () => H.fake.listUsage,
}));
vi.mock("@/packages/membership-store/convex-client", () => ({
  buildConvexMembershipStore: H.spy.buildConvex,
}));
vi.mock("@/packages/membership-store/factory", () => ({
  createMembershipStore: (cfg: unknown, builder: unknown) => {
    H.cap.membershipArgs = [cfg, builder];
    return H.fake.membership;
  },
}));
vi.mock("@/core/mirror-status", () => ({
  createMirrorStatusStore: () => H.fake.mirrorStore,
}));
vi.mock("@/core/picker-controller", () => ({
  createPickerController: (deps: Caps["pickerDeps"]) => {
    H.cap.pickerDeps = deps;
    return H.fake.picker;
  },
}));
vi.mock("@/core/settings", () => ({ createSettings: () => H.fake.settings }));
vi.mock("@/packages/tweet-read", () => ({ author: H.spy.extractAuthor }));
vi.mock("@/packages/tweet-actions/actions", () => ({
  createTweetActions: () => H.fake.caret,
}));
vi.mock("@/packages/x-client/x-page-client", () => ({
  createXPageClient: (options: Caps["xPageOptions"]) => {
    H.cap.xPageOptions = options;
    return H.fake.xPage;
  },
}));
vi.mock("@/core/selection-store", async () => {
  const actual =
    await vi.importActual<typeof import("@/core/selection-store")>("@/core/selection-store");
  return {
    ...actual,
    createSelectionStore: () => {
      const store = actual.createSelectionStore();
      H.cap.selection = store;
      return store;
    },
  };
});
vi.mock("@/ui/mount", () => ({
  createUiRoot: () => H.fake.uiHost,
  attachShadowRoot: (host: HTMLElement) => {
    if (H.config.shadowError) throw new Error("shadow unavailable");
    H.cap.shadowHost = host;
    return { mount: document.createElement("div") };
  },
}));

let sendMessage: ReturnType<typeof vi.fn>;
let addMessageListener: ReturnType<typeof vi.fn>;
let openSpy: ReturnType<typeof vi.spyOn>;
let computedStyleSpy: ReturnType<typeof vi.spyOn>;
let windowAddEventListenerSpy: ReturnType<typeof vi.spyOn>;
let documentAddEventListenerSpy: ReturnType<typeof vi.spyOn>;
let previousChrome: unknown;
let pageShowListener: ((event: PageTransitionEvent) => void) | undefined;
let prerenderingChangeListener: (() => void) | undefined;

function setChrome(opts: { sendThrows?: boolean; addThrows?: boolean } = {}) {
  sendMessage = vi.fn(() => {
    if (opts.sendThrows) throw new Error("sw gone");
    return { catch: (cb: AnyFn) => cb() }; // invoke the swallow-error arrow
  });
  addMessageListener = vi.fn((cb: Caps["onMessage"]) => {
    if (opts.addThrows) throw new Error("no runtime");
    H.cap.onMessage = cb;
  });
  globalThis.chrome = {
    ...(previousChrome as typeof chrome),
    runtime: { sendMessage, onMessage: { addListener: addMessageListener } },
  } as unknown as typeof chrome;
}

function publishSettings(next: Record<string, unknown>): void {
  for (const listener of H.cap.settingsListeners ?? []) listener(next);
}

async function importMain() {
  vi.resetModules();
  await import("@/content/main");
}

beforeEach(() => {
  previousChrome = globalThis.chrome;
  H.cap = {};
  H.config.settings = {
    backend: "rest",
    activation: "manual",
    highContrast: false,
  };
  H.config.onboarded = false;
  H.config.stubbed = false;
  H.config.computedPosition = "static";
  H.config.shadowError = false;
  for (const m of Object.values(H.fake.controller)) m.mockClear();
  for (const m of Object.values(H.fake.filter)) m.mockClear();
  H.fake.filterStore.dispose.mockClear();
  for (const value of Object.values(H.fake.xPage)) {
    if (typeof value === "function" && "mockClear" in value) value.mockClear();
  }
  H.fake.installFilter.mockReset();
  H.fake.installFilter.mockResolvedValue(H.fake.filter);
  H.fake.membership = {};
  // Uncleared, `waitFor(scanner.start)` resolves off the PREVIOUS test's boot, so a
  // later assertion can read state this boot hasn't written yet.
  for (const m of Object.values(H.fake.scanner)) m.mockClear();
  for (const m of Object.values(H.fake.hover)) m.mockClear();
  for (const m of Object.values(H.fake.overlays)) m.mockClear();
  for (const m of Object.values(H.fake.mirrorStore)) m.mockClear();
  H.fake.selectTapDispose.mockClear();
  H.fake.keyboardDispose.mockClear();
  H.fake.routeDispose.mockClear();
  H.fake.highContrastUnsubscribe.mockClear();
  H.fake.hover.targetTweet.mockReturnValue(null);
  H.fake.filter.isStubbed.mockImplementation(() => H.config.stubbed);
  H.fake.filter.isPaletteOpen.mockReturnValue(false);
  H.fake.coach.isOnboarded.mockImplementation(async () => H.config.onboarded);
  H.fake.settings.get.mockClear();
  H.fake.settings.get.mockImplementation(async () => H.config.settings);
  H.fake.settings.subscribe.mockClear();
  H.fake.uiHost.host = document.createElement("div");
  H.fake.uiHost.root = document.createElement("div");
  H.fake.uiHost.render.mockClear();
  H.fake.uiHost.destroy.mockClear();
  H.spy.render.mockClear();
  H.spy.getFocusedTweet.mockReturnValue(null);
  (window as unknown as { fetch: unknown }).fetch = vi.fn();
  openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  computedStyleSpy = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation(() => ({ position: H.config.computedPosition }) as CSSStyleDeclaration);
  document.body.innerHTML = "";
  window.location.hash = "";
  pageShowListener = undefined;
  prerenderingChangeListener = undefined;
  const nativeWindowAddEventListener = window.addEventListener.bind(window);
  windowAddEventListenerSpy = vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "pageshow") {
      pageShowListener = listener as (event: PageTransitionEvent) => void;
      return;
    }
    nativeWindowAddEventListener(type, listener, options);
  }) as typeof window.addEventListener);
  const nativeDocumentAddEventListener = document.addEventListener.bind(document);
  documentAddEventListenerSpy = vi.spyOn(document, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "prerenderingchange") {
      prerenderingChangeListener = listener as () => void;
      return;
    }
    nativeDocumentAddEventListener(type, listener, options);
  }) as typeof document.addEventListener);
  setChrome();
});

afterEach(() => {
  globalThis.chrome = previousChrome as typeof chrome;
  openSpy.mockRestore();
  computedStyleSpy.mockRestore();
  windowAddEventListenerSpy.mockRestore();
  documentAddEventListenerSpy.mockRestore();
  delete (document as Document & { prerendering?: boolean }).prerendering;
  vi.restoreAllMocks();
});

function cellTweet(opts: { avatar?: boolean; userName?: boolean } = {}): {
  cell: HTMLElement;
  article: HTMLElement;
} {
  const cell = document.createElement("div");
  cell.setAttribute("data-testid", "cellInnerDiv");
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  if (opts.avatar) {
    const av = document.createElement("div");
    av.setAttribute("data-testid", "UserAvatar-Container-alice");
    article.appendChild(av);
  }
  if (opts.userName) {
    const un = document.createElement("div");
    un.setAttribute("data-testid", "User-Name");
    article.appendChild(un);
  }
  cell.appendChild(article);
  document.body.appendChild(cell);
  return { cell, article };
}

/** Grabs the mount() closure main.tsx handed to the most recent overlays.attach() call. */
function lastMount(): () => (() => void) | null {
  return H.fake.overlays.attach.mock.calls.at(-1)![1] as () => (() => void) | null;
}

describe("content boot (main.tsx)", () => {
  it("reannounces the retained awake count on a persisted pageshow", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    H.cap.selection!.add({ screenName: "alice" });
    sendMessage.mockClear();

    pageShowListener!({ persisted: true } as PageTransitionEvent);

    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:badge", count: 1 });
  });

  it("constructs one X page capability and passes its List seam to the controller", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());

    expect(H.cap.xPageOptions).toMatchObject({
      initialBackend: "rest",
      settings: H.fake.settings,
      graphqlCache: expect.any(Object),
      findAuthorCaret: expect.any(Function),
      dispatchSyntheticEscape: expect.any(Function),
    });
    expect(H.cap.controllerDeps?.backend).toBe(H.fake.xPage.lists);
  });

  it("ignores ordinary pageshow but reannounces dormant state from BFCache", async () => {
    await importMain();
    sendMessage.mockClear();

    pageShowListener!({ persisted: false } as PageTransitionEvent);
    expect(sendMessage).not.toHaveBeenCalled();

    pageShowListener!({ persisted: true } as PageTransitionEvent);
    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:state", state: "asleep" });
  });

  it("reannounces the retained count when a prerendered document activates", async () => {
    Object.defineProperty(document, "prerendering", { configurable: true, value: true });
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    H.cap.selection!.add({ screenName: "alice" });
    sendMessage.mockClear();

    prerenderingChangeListener!();

    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:badge", count: 1 });
  });

  it("on-demand: stays asleep until the popup wakes the tab, then wires everything", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "manual",
      highContrast: false,
      convexUrl: "https://x.convex.cloud",
      convexDeviceKey: "k",
    };
    await importMain();

    // main() announced dormancy and registered the status listener; start() did
    // NOT run yet (on-demand).
    expect(sendMessage).toHaveBeenCalledWith({
      type: "lasso:state",
      state: "asleep",
    });
    expect(H.cap.onMessage).toBeTypeOf("function");
    expect(H.cap.scannerCb).toBeUndefined();

    // status query is answered "asleep" before activation.
    const beforeWake = vi.fn();
    H.cap.onMessage!({ type: "lasso:status" }, {}, beforeWake);
    expect(beforeWake).toHaveBeenCalledWith({ awake: false });

    // Options may have changed while this on-demand tab was asleep. start() reads
    // the shared store again, rather than reusing main()'s dormant snapshot.
    H.config.settings = {
      ...H.config.settings,
      highContrast: true,
    };
    // popup wakes this tab → start() runs with activatedByUser=true.
    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    await vi.waitFor(() => expect(H.fake.controller.wake).toHaveBeenCalled());
    expect(H.fake.scanner.start).toHaveBeenCalled();

    // a second activate is a no-op (started guard); status now answers "awake".
    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    const afterWake = vi.fn();
    H.cap.onMessage!({ type: "lasso:status" }, {}, afterWake);
    expect(afterWake).toHaveBeenCalledWith({ awake: true });
    expect(H.fake.controller.wake).toHaveBeenCalledTimes(1);
    // An unrelated and wrong-way content message are ignored.
    H.cap.onMessage!({ type: "noise" }, {}, vi.fn());
    const wrongWay = vi.fn();
    H.cap.onMessage!({ type: "lasso:badge", count: 3 }, {}, wrongWay);
    expect(wrongWay).not.toHaveBeenCalled();

    // highContrast marked the UI host.
    expect(H.fake.uiHost.host.getAttribute("data-hc")).toBe("");
    // main(), the fresh activation read, then the host registry refresh.
    expect(H.fake.settings.get).toHaveBeenCalledTimes(3);

    // ---- one X page seam owns List reads and quick REST actions ----
    await H.cap.listCacheLoader!();
    expect(H.fake.xPage.ownedLists).toHaveBeenCalled();
    H.cap.pickerDeps!.recentIds("1", 5);
    expect(H.fake.listUsage.recentIds).toHaveBeenCalledWith("1", 5);
    await H.cap.pickerDeps!.memberships("alice");
    expect(H.fake.xPage.membershipListIds).toHaveBeenCalledWith("alice");
    expect(H.cap.pickerDeps!.membershipStore).toMatchObject({
      recordAssign: expect.any(Function),
      observe: expect.any(Function),
    });
    H.cap.pickerDeps!.currentOwner();
    expect(H.spy.getCurrentAccount).toHaveBeenCalled();

    // ---- membership store built from the configured Convex creds ----
    expect(H.cap.membershipArgs![0]).toMatchObject({
      convexUrl: "https://x.convex.cloud",
      convexDeviceKey: "k",
    });
    // main.tsx passes a *loader*, not the builder: the Convex client is a dynamic
    // chunk. Resolving it proves the import() is wired to the right export.
    const loadConvex = H.cap.membershipArgs![1] as () => Promise<unknown>;
    await expect(loadConvex()).resolves.toBe(H.spy.buildConvex);

    // ---- controller deps: quick actions, target, anchor, openUrl, owner ----
    const deps = H.cap.controllerDeps!;
    const quick = deps.quick as {
      mute: AnyFn;
      unmute: AnyFn;
      block: AnyFn;
      notInterested: AnyFn;
    };
    await quick.mute("alice");
    await quick.unmute("alice");
    await quick.block("alice");
    const tweetForCaret = document.createElement("article");
    quick.notInterested(tweetForCaret);
    expect(H.fake.xPage.mute).toHaveBeenCalledWith("alice");
    expect(H.fake.xPage.unmute).toHaveBeenCalledWith("alice");
    expect(H.fake.xPage.block).toHaveBeenCalledWith("alice");
    expect(H.fake.caret.notInterested).toHaveBeenCalledWith(tweetForCaret);

    (deps.openUrl as AnyFn)("https://example.com");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
    (deps.currentOwner as AnyFn)();
    expect(H.spy.getCurrentAccount).toHaveBeenCalled();

    // target.tweet is the hover tracker's targetTweet; target.author derives from it.
    const target = deps.target as { author: AnyFn; tweet: AnyFn };
    expect(target.tweet()).toBeNull(); // hover tracker's default mock: nothing hovered
    expect(target.author()).toBeNull();
    const focused = cellTweet({}).article;
    H.fake.hover.targetTweet.mockReturnValue(focused);
    expect(target.tweet()).toBe(focused);
    expect(target.author()).toEqual({ screenName: "a" });
    H.config.stubbed = true;
    expect(target.tweet()).toBeNull();
    expect(target.author()).toBeNull();
    H.config.stubbed = false;
    H.fake.hover.targetTweet.mockReturnValue(null);

    // anchorFor: a caret with a real rect clamps to the viewport; a zero rect → null.
    const anchorFor = deps.anchorFor as (el: Element) => unknown;
    const withCaret = document.createElement("div");
    const caret = document.createElement("div");
    caret.setAttribute("data-testid", "caret");
    caret.getBoundingClientRect = () =>
      ({
        right: 100,
        bottom: 200,
        width: 10,
        height: 10,
        left: 90,
        top: 190,
      }) as DOMRect;
    withCaret.appendChild(caret);
    expect(anchorFor(withCaret)).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
    });
    expect(anchorFor(document.createElement("div"))).toBeNull(); // no caret, zero rect

    // ---- keyboard run, route sync, scanner onScan, health breakage ----
    H.cap.keyboardRun!("toggle-select-mode");
    expect(H.fake.controller.command).toHaveBeenCalledWith("toggle-select-mode");
    H.fake.controller.command.mockReturnValueOnce(false);
    H.fake.filter.dismiss.mockReturnValueOnce(true);
    H.cap.keyboardRun!("escape");
    expect(H.fake.controller.command).toHaveBeenLastCalledWith("escape");
    expect(H.fake.filter.dismiss).toHaveBeenCalledTimes(1);
    const app = deps.app as {
      welcomeOpen: { value: boolean };
      pickerOpen: { value: boolean };
    };
    app.welcomeOpen.value = true;
    expect(H.cap.keyboardSurfaces!.modalOpen()).toBe(true);
    expect(H.cap.keyboardSurfaces!.togglePalette()).toBe(true);
    expect(H.fake.filter.togglePalette).not.toHaveBeenCalled();
    app.welcomeOpen.value = false;
    app.pickerOpen.value = true;
    expect(H.cap.keyboardSurfaces!.modalOpen()).toBe(true);
    expect(H.cap.keyboardSurfaces!.togglePalette()).toBe(true);
    expect(H.fake.filter.togglePalette).not.toHaveBeenCalled();
    app.pickerOpen.value = false;
    H.cap.routeCb!();
    expect(H.fake.filter.sync).toHaveBeenCalled();
    H.cap.scannerOpts!.onScan!(3, 1);
    expect(H.fake.health.record).toHaveBeenCalledWith(3, 1);
    H.cap.healthOnBreakage!();
    expect(H.fake.controller.reportBreakage).toHaveBeenCalled();

    // filter feature resolves which timeline it is on via the route module, so a
    // bound scope's preset can be applied on arrival (spec #31).
    H.cap.filterDeps!.scope();
    expect(H.spy.resolveScope).toHaveBeenCalledWith(location.pathname);
    const filterInScope = deps.filterInScope as () => boolean;
    H.spy.isInScope.mockReturnValueOnce(false);
    expect(filterInScope()).toBe(false); // off-route keys fall through in the controller
    H.spy.isInScope.mockReturnValueOnce(true);
    expect(filterInScope()).toBe(true); // and resume on a supported timeline

    // ---- the App vnode handed to the UI host exposes a working openUrl ----
    const appVnode = H.fake.uiHost.render.mock.calls[0]![0] as {
      props: { openUrl: AnyFn };
    };
    appVnode.props.openUrl("https://app.example");
    expect(openSpy).toHaveBeenCalledWith("https://app.example", "_blank", "noopener");

    // ---- hover-tracker wiring: resolve does the outermost-tweet walk, fallback
    // delegates to X's native cursor, onHover mirrors onto visualHover (observed
    // via a mounted overlay's `hovered` computed) ----
    const outer = cellTweet({ avatar: true }).article;
    const innerCell = document.createElement("div");
    const inner = document.createElement("article");
    inner.setAttribute("data-testid", "tweet");
    const innerChild = document.createElement("span");
    inner.appendChild(innerChild);
    innerCell.appendChild(inner);
    outer.appendChild(innerCell);
    expect(H.cap.hoverDeps!.resolve(innerChild)).toBe(outer);
    expect(H.cap.hoverDeps!.resolve(null)).toBeNull();
    H.spy.getFocusedTweet.mockReturnValueOnce(outer);
    expect(H.cap.hoverDeps!.fallback()).toBe(outer);

    // ---- scanner callback drives classify + overlay attach ----
    const a = cellTweet({ avatar: true });
    H.cap.scannerCb!(a.article);
    expect(H.fake.filter.classify).toHaveBeenCalledWith(a.article);
    expect(H.fake.overlays.attach).toHaveBeenCalledWith(a.article, expect.any(Function));
    let mountFn = lastMount();
    const disposeA = mountFn();
    expect(disposeA).toBeTypeOf("function");
    // overlay injected into the avatar; the OverlayBinding vnode wires onToggle
    // and its hovered computed tracks visualHover (which onHover mirrors into).
    const overlayCall = H.spy.render.mock.calls.at(-1) as [
      { props: { onToggle: AnyFn; hovered: { value: unknown } } },
      unknown,
    ];
    overlayCall[0].props.onToggle();
    expect(H.fake.controller.toggleSelect).toHaveBeenCalled();
    expect(overlayCall[0].props.hovered.value).toBe(false);
    H.cap.hoverDeps!.onHover(a.article);
    expect(overlayCall[0].props.hovered.value).toBe(true);
    H.cap.hoverDeps!.onHover(null);
    expect(overlayCall[0].props.hovered.value).toBe(false);

    // re-mounting the same host is injectOverlay's own guard (overlay flag present).
    expect(mountFn()).toBeNull();

    // the disposer unmounts the Preact tree (drops signal subscriptions) and
    // removes the host, matching the map-registry contract overlay-lifecycle relies on.
    disposeA!();
    expect(H.spy.render.mock.calls.at(-1)).toEqual([null, expect.anything()]);
    expect(a.article.querySelector("[data-lasso-overlay]")).toBeNull();

    // non-static avatar position branch.
    H.config.computedPosition = "relative";
    H.cap.scannerCb!(cellTweet({ avatar: true }).article);
    lastMount()();

    // avatar-absent: anchor falls back to User-Name, then to the article itself.
    H.cap.scannerCb!(cellTweet({ userName: true }).article);
    lastMount()();
    H.cap.scannerCb!(cellTweet({}).article);
    lastMount()();

    // A first-seen hidden cell mounts its overlay. Restoration reveals the
    // same host without a scanner remount, and the binding still works.
    H.fake.filter.classify.mockImplementationOnce((article: Element) => {
      article.parentElement?.setAttribute("data-lasso-filtered", "");
    });
    const stub = cellTweet({ avatar: true });
    const attachCallsBefore = H.fake.overlays.attach.mock.calls.length;
    H.cap.scannerCb!(stub.article);
    expect(stub.cell.hasAttribute("data-lasso-filtered")).toBe(true);
    expect(H.fake.filter.classify.mock.invocationCallOrder.at(-1)).toBeLessThan(
      H.fake.overlays.attach.mock.invocationCallOrder.at(-1)!,
    );
    expect(H.fake.overlays.attach.mock.calls.length).toBe(attachCallsBefore + 1);
    const disposeStub = lastMount()();
    const hiddenHost = stub.article.querySelector("[data-lasso-overlay]");
    expect(hiddenHost).not.toBeNull();
    const hiddenOverlayCall = H.spy.render.mock.calls.at(-1) as [
      { props: { onToggle: AnyFn } },
      unknown,
    ];
    const hiddenTogglesBefore = H.fake.controller.toggleSelect.mock.calls.length;

    stub.cell.removeAttribute("data-lasso-filtered");
    expect(stub.article.querySelector("[data-lasso-overlay]")).toBe(hiddenHost);
    expect(H.fake.overlays.attach.mock.calls.length).toBe(attachCallsBefore + 1);
    hiddenOverlayCall[0].props.onToggle();
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(hiddenTogglesBefore + 1);
    disposeStub?.();

    // Author-less Tweets still reach Filter. Only Author-dependent overlay work stops.
    const authorless = cellTweet({ avatar: true });
    const overlayCallsBefore = H.fake.overlays.attach.mock.calls.length;
    H.spy.extractAuthor.mockReturnValueOnce(null);
    H.cap.scannerCb!(authorless.article);
    expect(H.fake.filter.classify).toHaveBeenCalledWith(authorless.article);
    expect(H.fake.overlays.attach).toHaveBeenCalledTimes(overlayCallsBefore);

    // ---- select-tap wiring: isActive mirrors selectMode; resolveTarget applies
    // the overlay/lasso-root/no-tweet guards; onToggle extracts the author and
    // toggles, returning false when extraction fails (nothing to suppress) ----
    const selectTap = H.cap.selectTapDeps!;
    expect(selectTap.isActive()).toBe(false); // selectMode starts off
    H.cap.selection!.setSelectMode(true);
    expect(selectTap.isActive()).toBe(true);

    const sel = cellTweet({ avatar: true }).article;
    expect(selectTap.resolveTarget(sel)).toBe(sel);
    H.config.stubbed = true;
    expect(selectTap.resolveTarget(sel)).toBeNull();
    H.config.stubbed = false;
    expect(selectTap.resolveTarget(null)).toBeNull();
    expect(selectTap.resolveTarget(document.body)).toBeNull(); // no enclosing tweet

    // A tap inside a quoted (nested) tweet resolves the outermost article — the
    // one that owns the author — not the quoted inner one.
    const quotedOuter = cellTweet({ avatar: true }).article;
    const quotedInner = document.createElement("article");
    quotedInner.setAttribute("data-testid", "tweet");
    const quotedChild = document.createElement("span");
    quotedInner.appendChild(quotedChild);
    quotedOuter.appendChild(quotedInner);
    expect(selectTap.resolveTarget(quotedChild)).toBe(quotedOuter);

    const overlayHost = document.createElement("span");
    overlayHost.setAttribute("data-lasso-overlay", "");
    const inOverlay = document.createElement("i");
    overlayHost.appendChild(inOverlay);
    document.body.appendChild(overlayHost);
    expect(selectTap.resolveTarget(inOverlay)).toBeNull(); // the check handles itself

    const root = document.createElement("div");
    root.id = "lasso-root";
    const inRoot = document.createElement("i");
    root.appendChild(inRoot);
    document.body.appendChild(root);
    expect(selectTap.resolveTarget(inRoot)).toBeNull(); // Lasso UI passes through

    const togglesBefore = H.fake.controller.toggleSelect.mock.calls.length;
    H.spy.extractAuthor.mockReturnValueOnce(null);
    expect(selectTap.onToggle(sel)).toBe(false); // no author → nothing to toggle
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(togglesBefore);

    selectTap.onToggle(sel);
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(togglesBefore + 1);
  });

  it("answers a deferred failed activation only after rollback", async () => {
    const error = new Error("onboarding read failed");
    H.fake.coach.isOnboarded.mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();

    const response = vi.fn();
    expect(H.cap.onMessage!({ type: "lasso-activate" }, {}, response)).toBe(true);
    expect(response).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ awake: false }));
    expect(H.fake.scanner.stop).toHaveBeenCalledTimes(1);
    expect(H.fake.overlays.disposeAll).toHaveBeenCalledTimes(1);
    expect(H.fake.routeDispose).toHaveBeenCalledTimes(1);
    expect(H.fake.keyboardDispose).toHaveBeenCalledTimes(1);
    expect(H.fake.filter.unmount).toHaveBeenCalledTimes(1);
    expect(H.fake.filterStore.dispose).toHaveBeenCalledTimes(1);
    expect(H.fake.selectTapDispose).toHaveBeenCalledTimes(1);
    // Mirror and high-contrast hosts release settings observation. The X facade
    // owns and releases its internal subscription behind one disposer.
    expect(H.fake.highContrastUnsubscribe).toHaveBeenCalledTimes(2);
    expect(H.fake.xPage.dispose).toHaveBeenCalledOnce();
    expect(H.fake.uiHost.destroy).toHaveBeenCalledTimes(1);
    expect(H.fake.hover.dispose).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("contains cleanup failures while rolling a failed boot back", async () => {
    H.fake.coach.isOnboarded.mockRejectedValueOnce(new Error("onboarding read failed"));
    H.fake.scanner.stop.mockImplementationOnce(() => {
      throw new Error("scanner already gone");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();

    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("[Lasso] activation cleanup failed", expect.any(Error)),
    );
    expect(H.fake.uiHost.destroy).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("unwinds an overlay mount when its shadow root cannot be created", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    const tweet = cellTweet({ avatar: true });
    H.cap.scannerCb!(tweet.article);
    H.config.shadowError = true;

    expect(lastMount()).toThrow("shadow unavailable");
    expect(tweet.article.querySelector("[data-lasso-overlay]")).toBeNull();
  });

  it("on-demand hotkey enters select mode after a not-onboarded boot", async () => {
    H.config.onboarded = false;
    await importMain();
    const dormant = H.cap.keyboardLayers![0]!;
    expect(dormant.keymap).toEqual([{ combo: "s", command: "toggle-select-mode" }]);

    dormant.run("toggle-select-mode");
    expect(H.fake.controller.trySelectMode).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(H.fake.controller.trySelectMode).toHaveBeenCalledTimes(1));
    expect(H.fake.controller.wake).not.toHaveBeenCalled();
    expect(H.cap.keyboardLayers).toHaveLength(2);
    expect(dormant.dispose).toHaveBeenCalledTimes(1);
    expect(H.cap.keyboardLayers![1]!.dispose).not.toHaveBeenCalled();
  });

  it("dormant hotkey survives failed activation and retries", async () => {
    H.fake.coach.isOnboarded.mockRejectedValueOnce(new Error("first boot fails"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();
    const dormant = H.cap.keyboardLayers![0]!;

    dormant.run("toggle-select-mode");
    await vi.waitFor(() => expect(H.fake.scanner.stop).toHaveBeenCalledTimes(1));
    expect(dormant.dispose).not.toHaveBeenCalled();
    expect(H.fake.controller.trySelectMode).not.toHaveBeenCalled();

    dormant.run("toggle-select-mode");
    await vi.waitFor(() => expect(H.fake.controller.trySelectMode).toHaveBeenCalledTimes(1));
    expect(dormant.dispose).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("coalesces hotkey and toolbar activation without losing either intent", async () => {
    let resolveFeature!: () => void;
    H.fake.installFilter.mockImplementationOnce(
      () =>
        new Promise<typeof H.fake.filter>((resolve) => {
          resolveFeature = () => resolve(H.fake.filter);
        }),
    );
    await importMain();

    H.cap.keyboardLayers![0]!.run("toggle-select-mode");
    const toolbar = vi.fn();
    expect(H.cap.onMessage!({ type: "lasso-activate" }, {}, toolbar)).toBe(true);
    await vi.waitFor(() => expect(H.fake.installFilter).toHaveBeenCalledTimes(1));
    expect(toolbar).not.toHaveBeenCalled();

    resolveFeature();
    await vi.waitFor(() => expect(toolbar).toHaveBeenCalledWith({ awake: true }));
    expect(H.fake.controller.wake).toHaveBeenCalledTimes(1);
    expect(H.fake.controller.trySelectMode).toHaveBeenCalledTimes(1);
  });

  it("keeps a committed boot awake when queued intents throw", async () => {
    H.fake.controller.wake.mockImplementationOnce(() => {
      throw new Error("wake rejected");
    });
    H.fake.controller.trySelectMode.mockImplementationOnce(() => {
      throw new Error("select mode rejected");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();

    H.cap.keyboardLayers![0]!.run("toggle-select-mode");
    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("[Lasso] wake intent failed", expect.any(Error)),
    );
    expect(log).toHaveBeenCalledWith("[Lasso] select-mode intent failed", expect.any(Error));
    const status = vi.fn();
    H.cap.onMessage!({ type: "lasso:status" }, {}, status);
    expect(status).toHaveBeenCalledWith({ awake: true });
    log.mockRestore();
  });

  it("rolls back a failed boot and retries from idle", async () => {
    H.fake.coach.isOnboarded.mockRejectedValueOnce(new Error("first boot fails"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();

    const failed = vi.fn();
    H.cap.onMessage!({ type: "lasso-activate" }, {}, failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith({ awake: false }));

    H.fake.coach.isOnboarded.mockResolvedValueOnce(false);
    const retried = vi.fn();
    H.cap.onMessage!({ type: "lasso-activate" }, {}, retried);
    await vi.waitFor(() => expect(retried).toHaveBeenCalledWith({ awake: true }));
    expect(H.fake.scanner.start).toHaveBeenCalledTimes(2);
    expect(H.fake.controller.wake).toHaveBeenCalledTimes(1);
    expect(H.fake.filterStore.dispose).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("does not announce asleep after a concurrent activation already committed", async () => {
    let rejectInitial!: (reason: unknown) => void;
    const initial = new Promise<unknown>((_resolve, reject) => {
      rejectInitial = reject;
    });
    H.fake.settings.get.mockClear();
    H.fake.settings.get.mockImplementationOnce(() => initial);
    await importMain();
    await vi.waitFor(() => expect(H.fake.settings.get).toHaveBeenCalledTimes(1));

    const response = vi.fn();
    H.cap.onMessage!({ type: "lasso-activate" }, {}, response);
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith({ awake: true }));
    const messagesBeforeFailure = sendMessage.mock.calls.length;

    rejectInitial(new Error("stale initial read"));
    await Promise.resolve();
    expect(sendMessage.mock.calls.slice(messagesBeforeFailure)).not.toContainEqual([
      { type: "lasso:state", state: "asleep" },
    ]);
  });

  it("retries a transient startup settings read and auto-activates without user input", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    H.fake.settings.get.mockRejectedValueOnce(new Error("storage waking"));

    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalledOnce());

    expect(H.fake.settings.get.mock.calls.length).toBeGreaterThanOrEqual(3); // failed read, retry, install snapshot
    expect(H.fake.installFilter).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:state", state: "awake" });
    expect(sendMessage).not.toHaveBeenCalledWith({ type: "lasso:state", state: "asleep" });
  });

  it("wires onTweetRemoved to release the overlay + hover seams, clearing visualHover only on a match", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());

    const a = cellTweet({ avatar: true });
    H.cap.scannerCb!(a.article);
    lastMount()();
    const overlayCall = H.spy.render.mock.calls.at(-1) as [
      { props: { hovered: { value: unknown } } },
      unknown,
    ];
    const hoveredA = overlayCall[0].props.hovered;

    H.cap.hoverDeps!.onHover(a.article); // visualHover now points at a.article
    expect(hoveredA.value).toBe(true);

    const b = document.createElement("article");
    H.cap.scannerOpts!.onTweetRemoved!(b); // unrelated removal — visualHover untouched
    expect(H.fake.overlays.releaseFor).toHaveBeenCalledWith(b);
    expect(H.fake.hover.release).toHaveBeenCalledWith(b);
    expect(hoveredA.value).toBe(true);

    H.cap.scannerOpts!.onTweetRemoved!(a.article); // the hovered article is pruned
    expect(H.fake.overlays.releaseFor).toHaveBeenCalledWith(a.article);
    expect(H.fake.hover.release).toHaveBeenCalledWith(a.article);
    expect(hoveredA.value).toBe(false);
  });

  it("wires onMirrorResult to the mirror-status store's publish when the Mirror is configured", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
      convexUrl: "https://x.convex.cloud",
      convexDeviceKey: "k",
      mirrorConfigId: "mirror-1",
    };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    const onMirrorResult = H.cap.controllerDeps!.onMirrorResult as (r: unknown) => void;
    expect(onMirrorResult).toBeTypeOf("function");

    expect(H.cap.controllerDeps!.mirrorConfigurationId).toBeTypeOf("function");
    expect((H.cap.controllerDeps!.mirrorConfigurationId as () => string | null)()).toBe("mirror-1");
    onMirrorResult({ ok: true, at: 1, configId: "mirror-1" });
    expect(H.fake.mirrorStore.publish).toHaveBeenCalledWith({
      ok: true,
      at: 1,
      configId: "mirror-1",
    });
  });

  it("exposes no Mirror status identity while Mirror settings are absent", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    await importMain();
    await vi.waitFor(() => expect(H.cap.controllerDeps).toBeTypeOf("object"));
    const mirrorConfigurationId = H.cap.controllerDeps!.mirrorConfigurationId as () =>
      | string
      | null;
    expect(mirrorConfigurationId()).toBeNull();
    expect(H.fake.mirrorStore.publish).not.toHaveBeenCalled();
  });

  it("disables the retained Mirror adapter when live settings clear its key", async () => {
    const retained = {
      recordAssign: vi.fn(async () => {}),
      reconcileAuthor: vi.fn(async () => {}),
      replaceCatalog: vi.fn(async () => {}),
      observe: vi.fn(() => () => {}),
    };
    H.fake.membership = retained;
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
      convexUrl: "https://x.convex.cloud",
      convexDeviceKey: "k",
    };
    await importMain();
    await vi.waitFor(() => expect(H.cap.membershipArgs).toBeDefined());
    const store = H.cap.controllerDeps!.membershipStore as {
      recordAssign: (owner: unknown, list: unknown, changes: unknown[]) => Promise<void>;
    };

    await store.recordAssign({ userId: "1", screenName: "operator" }, { id: "L1", name: "A" }, []);
    expect(retained.recordAssign).toHaveBeenCalledOnce();

    publishSettings({ ...H.config.settings, convexUrl: undefined, convexDeviceKey: undefined });
    await store.recordAssign({ userId: "1", screenName: "operator" }, { id: "L1", name: "A" }, []);
    expect(retained.recordAssign).toHaveBeenCalledOnce();
  });

  it("auto activation boots immediately without a user wake", async () => {
    H.config.settings = {
      backend: "graphql",
      activation: "auto",
      highContrast: false,
    };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    expect(H.fake.controller.wake).not.toHaveBeenCalled(); // activatedByUser=false
    expect(sendMessage).toHaveBeenCalledWith({
      type: "lasso:state",
      state: "awake",
    });
    // highContrast=false: the UI host is not marked.
    expect(H.fake.uiHost.host.hasAttribute("data-hc")).toBe(false);
    // overlay attach with highContrast off + non-avatar fallback path.
    H.config.computedPosition = "relative";
    H.cap.scannerCb!(cellTweet({ userName: true }).article);
    lastMount()();
  });

  it("gives an open Filter palette exclusive keyboard ownership", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    H.fake.filter.isPaletteOpen.mockReturnValue(true);
    H.fake.filter.dismiss.mockReturnValue(true);
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());

    expect(H.cap.keyboardRun!("toggle-select-mode")).toBe(true);
    expect(H.fake.controller.command).not.toHaveBeenCalled();
    expect(H.fake.filter.dismiss).not.toHaveBeenCalled();

    expect(H.cap.keyboardRun!("escape")).toBe(true);
    expect(H.fake.filter.dismiss).toHaveBeenCalledOnce();
    expect(H.fake.controller.command).not.toHaveBeenCalled();
    expect(H.cap.keyboardSurfaces!.modalOpen()).toBe(true);
  });

  it("passes synthetic Escape and author-caret lookup into the page driver", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    const driver = H.cap.xPageOptions!;
    const unusable = document.createElement("article");
    unusable.setAttribute("data-testid", "tweet");
    document.body.appendChild(unusable);
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    const caret = document.createElement("button");
    caret.setAttribute("data-testid", "caret");
    article.appendChild(caret);
    document.body.appendChild(article);
    H.spy.extractAuthor.mockImplementation((node) =>
      node === unusable || node === article ? ({ screenName: "Alice" } as never) : null,
    );

    // A reused earlier Alice cell without a caret cannot hide a later usable cell.
    expect(driver.findAuthorCaret("alice")).toBe(caret);
    expect(driver.findAuthorCaret("missing")).toBeNull();
    const keydown = vi.fn();
    article.addEventListener("keydown", keydown);
    driver.dispatchSyntheticEscape(article);
    expect(keydown).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    const pageDocument = new Document();
    const onDocument = vi.fn();
    pageDocument.addEventListener("keydown", onDocument, { once: true });
    driver.dispatchSyntheticEscape(pageDocument);
    expect(onDocument).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    H.spy.extractAuthor.mockReturnValue({ screenName: "a" } as never);
  });

  it("keeps root and late overlay hosts live across high-contrast changes", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    const root = H.fake.uiHost.host;
    expect(root.hasAttribute("data-hc")).toBe(false);

    const tweet = cellTweet({ avatar: true });
    H.cap.scannerCb!(tweet.article);
    const dispose = lastMount()()!;
    const overlay = H.cap.shadowHost!;
    expect(overlay.hasAttribute("data-hc")).toBe(false);

    publishSettings({ highContrast: true });
    expect(root.hasAttribute("data-hc")).toBe(true);
    expect(overlay.hasAttribute("data-hc")).toBe(true);
    publishSettings({ highContrast: false });
    expect(root.hasAttribute("data-hc")).toBe(false);
    expect(overlay.hasAttribute("data-hc")).toBe(false);

    dispose();
    publishSettings({ highContrast: true });
    expect(overlay.hasAttribute("data-hc")).toBe(false);
  });

  it("forces the welcome card when the install hash is present", async () => {
    window.location.hash = "#lasso-welcome";
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    H.config.onboarded = true; // irrelevant: the hash wins
    const replace = vi.spyOn(window.history, "replaceState");
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    expect(replace).toHaveBeenCalled(); // hash stripped after forcing the card
    replace.mockRestore();
  });

  it("shows the welcome card once for a not-yet-onboarded user", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    H.config.onboarded = false;
    await importMain();
    await vi.waitFor(() => expect(H.fake.coach.isOnboarded).toHaveBeenCalled());
  });

  it("skips the welcome card for an onboarded user (no hash)", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "auto",
      highContrast: false,
    };
    H.config.onboarded = true;
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
  });

  it("survives a missing service worker (sendMessage + addListener throwing)", async () => {
    setChrome({ sendThrows: true, addThrows: true });
    H.config.settings = {
      backend: "rest",
      activation: "manual",
      highContrast: false,
    };
    // Importing must not throw even though every chrome call blows up.
    await expect(importMain()).resolves.toBeUndefined();
  });

  it("returns asleep if the activation reply channel closes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();
    const reply = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("reply channel closed");
      })
      .mockImplementationOnce(() => {});

    expect(H.cap.onMessage!({ type: "lasso-activate" }, {}, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenLastCalledWith({ awake: false }));
    expect(log).toHaveBeenCalledWith("[Lasso] activation response failed", expect.any(Error));
    log.mockRestore();
  });

  it("keeps dormant hotkey retryable when the initial settings read fails", async () => {
    H.fake.settings.get.mockRejectedValueOnce(new Error("storage dead"));
    await importMain();
    const dormant = H.cap.keyboardLayers![0]!;
    expect(dormant.dispose).not.toHaveBeenCalled();
    dormant.run("toggle-select-mode");
    await vi.waitFor(() => expect(H.fake.controller.trySelectMode).toHaveBeenCalledTimes(1));
    expect(dormant.dispose).toHaveBeenCalledTimes(1);
  });

  it("consults Filter for palette state when no app modal is open", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    H.config.onboarded = true; // welcomeOpen stays closed → appState.modalOpen() is false
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());

    // With no app modal open, the `appState.modalOpen() || …` short-circuit falls
    // through to Filter: each surface delegates to filter.isPaletteOpen() /
    // filter.togglePalette() (the previously-uncovered right-hand arm).
    expect(H.cap.keyboardSurfaces!.modalOpen()).toBe(false);
    expect(H.fake.filter.isPaletteOpen).toHaveBeenCalled();
    expect(H.cap.keyboardSurfaces!.togglePalette()).toBe(false);
    expect(H.fake.filter.togglePalette).toHaveBeenCalled();
  });

  it("records a mid-boot select-mode intent onto the in-flight boot", async () => {
    let resolveFeature!: () => void;
    H.fake.installFilter.mockImplementationOnce(
      () =>
        new Promise<typeof H.fake.filter>((resolve) => {
          resolveFeature = () => resolve(H.fake.filter);
        }),
    );
    await importMain();

    // A toolbar wake starts the boot; while it is still booting the dormant
    // hotkey fires, queuing a select-mode intent onto the same in-flight boot.
    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    await vi.waitFor(() => expect(H.fake.installFilter).toHaveBeenCalledTimes(1));
    H.cap.keyboardLayers![0]!.run("toggle-select-mode");

    resolveFeature();
    await vi.waitFor(() => expect(H.fake.controller.trySelectMode).toHaveBeenCalledTimes(1));
    expect(H.fake.controller.wake).toHaveBeenCalledTimes(1);
  });

  it("logs an init failure when the module-load boot rejects", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("console gone");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await importMain();

    // main()'s first statement throws before any try/catch, so the module-level
    // `main().catch(...)` defensive handler is what logs the rejection.
    await vi.waitFor(() =>
      expect(err).toHaveBeenCalledWith("[Lasso] init failed", expect.any(Error)),
    );
    info.mockRestore();
    err.mockRestore();
  });

  it("does not re-announce asleep when a wake commits before the manual read resolves", async () => {
    let resolveInitial!: (settings: unknown) => void;
    const initial = new Promise<unknown>((resolve) => {
      resolveInitial = resolve;
    });
    H.config.settings = { backend: "rest", activation: "manual", highContrast: false };
    H.fake.settings.get.mockClear();
    H.fake.settings.get.mockImplementationOnce(() => initial); // main()'s own read hangs
    await importMain();
    await vi.waitFor(() => expect(H.fake.settings.get).toHaveBeenCalledTimes(1));

    // A toolbar wake commits awake (its install() reads the resolved store copy)
    // while main()'s dormant settings read is still pending.
    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    const before = sendMessage.mock.calls.length;

    // main()'s read now resolves with activationState already "awake": the
    // else-if guard sees the committed state and leaves the badge untouched.
    resolveInitial(H.config.settings);
    await initial;
    await Promise.resolve();
    expect(sendMessage.mock.calls.slice(before)).not.toContainEqual([
      { type: "lasso:state", state: "asleep" },
    ]);
  });

  it("does not announce asleep while a boot is still in flight as the manual read resolves", async () => {
    let resolveInitial!: (settings: unknown) => void;
    let resolveFeature!: () => void;
    const initial = new Promise<unknown>((resolve) => {
      resolveInitial = resolve;
    });
    H.config.settings = { backend: "rest", activation: "manual", highContrast: false };
    H.fake.settings.get.mockClear();
    H.fake.settings.get.mockImplementationOnce(() => initial); // main()'s own read hangs
    H.fake.installFilter.mockImplementationOnce(
      () =>
        new Promise<typeof H.fake.filter>((resolve) => {
          resolveFeature = () => resolve(H.fake.filter);
        }),
    );
    await importMain();
    await vi.waitFor(() => expect(H.fake.settings.get).toHaveBeenCalledTimes(1));

    // A toolbar wake starts a boot that stalls inside installFilter, so
    // activationState is "booting" (neither awake nor idle) when main() resumes.
    H.cap.onMessage!({ type: "lasso-activate" }, {}, vi.fn());
    await vi.waitFor(() => expect(H.fake.installFilter).toHaveBeenCalledTimes(1));
    const before = sendMessage.mock.calls.length;

    resolveInitial(H.config.settings);
    await initial;
    await Promise.resolve();
    expect(sendMessage.mock.calls.slice(before)).not.toContainEqual([
      { type: "lasso:state", state: "asleep" },
    ]);

    resolveFeature();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
  });
});
