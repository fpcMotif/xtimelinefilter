import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// main.tsx is the content boot path: it runs main() at import, wiring ~30
// collaborators together. We mock every collaborator, capture the closures they
// receive (the deps objects, scanner/keyboard/route callbacks, the rendered App
// and Overlay vnodes), then drive each one — the only honest way to cover an
// import-time entry point (unit-test-design.md §11).

type AnyFn = (...args: unknown[]) => unknown;
type Caps = {
  controllerDeps?: Record<string, AnyFn | Record<string, AnyFn> | unknown>;
  xlistThunks?: { rest: AnyFn; dom: AnyFn; graphql: AnyFn };
  listCacheLoader?: AnyFn;
  pickerDeps?: { recentIds: AnyFn; memberships: AnyFn };
  scannerCb?: (author: unknown, article: Element) => void;
  scannerOpts?: { onScan?: AnyFn };
  keyboardRun?: AnyFn;
  routeCb?: AnyFn;
  healthOnBreakage?: AnyFn;
  filterDeps?: { settings: unknown; highContrast: boolean; inScope: AnyFn };
  membershipArgs?: [unknown, unknown];
  onMessage?: (msg: unknown, sender: unknown, send: AnyFn) => void;
  shadowHost?: HTMLElement;
  selection?: { setSelectMode: (on: boolean) => void };
  clickHandler?: AnyFn;
};

const H = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    config: {
      settings: {} as Record<string, unknown>,
      onboarded: false,
      stubbed: false,
      computedPosition: "static",
    },
    cap: {} as Caps,
    fake: {
      controller: {
        command: vi.fn(),
        wake: vi.fn(),
        toggleSelect: vi.fn(),
        reportBreakage: vi.fn(),
      },
      filter: {
        classify: vi.fn(),
        isStubbed: vi.fn(),
        sync: vi.fn(),
        unmount: vi.fn(),
      },
      coach: {
        isOnboarded: vi.fn(),
        tryShowTip: vi.fn(async () => false),
        hintsActive: vi.fn(async () => false),
      },
      settings: { get: vi.fn() },
      auth: { credentials: vi.fn(() => ({ ct0: "tok" })) },
      caret: { notInterested: fn() },
      listCache: {},
      listUsage: { recentIds: vi.fn(() => []), record: vi.fn() },
      picker: {},
      membership: {},
      backend: {},
      health: { record: vi.fn() },
      uiHost: {
        host: null as unknown as HTMLElement,
        render: vi.fn(),
        root: null as unknown as HTMLElement,
      },
      scanner: { start: vi.fn() },
    },
    spy: {
      render: vi.fn(),
      getCurrentAccount: vi.fn(() => ({ userId: "1", screenName: "op" })),
      getFocusedTweet: vi.fn(() => null as Element | null),
      extractAuthor: vi.fn(() => ({ screenName: "a" }) as unknown),
      isInScope: vi.fn(() => true),
      fetchOwnedLists: vi.fn(async () => []),
      fetchMembershipListIds: vi.fn(async () => []),
      muteUser: vi.fn(async () => {}),
      unmuteUser: vi.fn(async () => {}),
      blockUser: vi.fn(async () => {}),
      createDomPageDriver: vi.fn(() => ({})),
      buildConvex: vi.fn(),
      // RestXListApi calls its credentials thunk so the `() => auth.credentials()`
      // closure handed to it is actually exercised. A plain function (not an
      // arrow) so it is constructable with `new`.
      RestXListApi: vi.fn(function (this: unknown, _fetch: unknown, creds: AnyFn) {
        creds();
      }),
      DomXListApi: vi.fn(),
      GraphqlXListApi: vi.fn(),
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
    return Promise.resolve(H.fake.filter);
  },
}));
vi.mock("@/content/get-current-account", () => ({ getCurrentAccount: H.spy.getCurrentAccount }));
vi.mock("@/content/get-focused-tweet", () => ({ getFocusedTweet: H.spy.getFocusedTweet }));
vi.mock("@/content/keyboard", () => ({
  DEFAULT_KEYMAP: [],
  installKeyboardLayer: (opts: { run: AnyFn }) => {
    H.cap.keyboardRun = opts.run;
  },
}));
vi.mock("@/content/route", () => ({
  isInScope: H.spy.isInScope,
  onRouteChange: (cb: AnyFn) => {
    H.cap.routeCb = cb;
  },
}));
vi.mock("@/content/scanner-health", () => ({
  createScannerHealth: (opts: { onBreakage: AnyFn }) => {
    H.cap.healthOnBreakage = opts.onBreakage;
    return H.fake.health;
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
vi.mock("@/core/list-usage", () => ({ createListUsage: () => H.fake.listUsage }));
vi.mock("@/core/membership-store/convex-client", () => ({
  buildConvexMembershipStore: H.spy.buildConvex,
}));
vi.mock("@/core/membership-store/factory", () => ({
  createMembershipStore: (cfg: unknown, builder: unknown) => {
    H.cap.membershipArgs = [cfg, builder];
    return H.fake.membership;
  },
}));
vi.mock("@/core/picker-controller", () => ({
  createPickerController: (deps: Caps["pickerDeps"]) => {
    H.cap.pickerDeps = deps;
    return H.fake.picker;
  },
}));
vi.mock("@/core/settings", () => ({ createSettings: () => H.fake.settings }));
vi.mock("@/core/tweet-read", () => ({ author: H.spy.extractAuthor }));
vi.mock("@/core/x-client/auth", () => ({ createDocumentAuth: () => H.fake.auth }));
vi.mock("@/core/x-client/caret-actions", () => ({ createCaretActions: () => H.fake.caret }));
vi.mock("@/core/x-client/dom-api", () => ({ DomXListApi: H.spy.DomXListApi }));
vi.mock("@/core/x-client/dom-page-driver", () => ({
  createDomPageDriver: H.spy.createDomPageDriver,
}));
vi.mock("@/core/x-client/factory", () => ({
  createXListApi: (_backend: unknown, thunks: Caps["xlistThunks"]) => {
    H.cap.xlistThunks = thunks;
    return H.fake.backend;
  },
}));
vi.mock("@/core/x-client/graphql-api", () => ({ GraphqlXListApi: H.spy.GraphqlXListApi }));
vi.mock("@/core/x-client/graphql-config", () => ({ DEFAULT_GRAPHQL_CONFIG: {} }));
vi.mock("@/core/x-client/lists-provider", () => ({
  fetchMembershipListIds: H.spy.fetchMembershipListIds,
  fetchOwnedLists: H.spy.fetchOwnedLists,
}));
vi.mock("@/core/x-client/rest-api", () => ({
  blockUser: H.spy.blockUser,
  muteUser: H.spy.muteUser,
  unmuteUser: H.spy.unmuteUser,
  RestXListApi: H.spy.RestXListApi,
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
    H.cap.shadowHost = host;
    return { mount: document.createElement("div") };
  },
}));

let sendMessage: ReturnType<typeof vi.fn>;
let addMessageListener: ReturnType<typeof vi.fn>;
let openSpy: ReturnType<typeof vi.spyOn>;
let computedStyleSpy: ReturnType<typeof vi.spyOn>;
let previousChrome: unknown;

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

async function importMain() {
  vi.resetModules();
  await import("@/content/main");
}

beforeEach(() => {
  previousChrome = globalThis.chrome;
  H.cap = {};
  H.config.settings = { backend: "rest", activation: "manual", highContrast: false };
  H.config.onboarded = false;
  H.config.stubbed = false;
  H.config.computedPosition = "static";
  for (const m of Object.values(H.fake.controller)) m.mockClear();
  for (const m of Object.values(H.fake.filter)) m.mockClear();
  H.fake.filter.isStubbed.mockImplementation(() => H.config.stubbed);
  H.fake.coach.isOnboarded.mockImplementation(async () => H.config.onboarded);
  H.fake.settings.get.mockImplementation(async () => H.config.settings);
  H.fake.uiHost.host = document.createElement("div");
  H.fake.uiHost.root = document.createElement("div");
  H.fake.uiHost.render.mockClear();
  H.spy.render.mockClear();
  H.spy.getFocusedTweet.mockReturnValue(null);
  (window as unknown as { fetch: unknown }).fetch = vi.fn();
  openSpy = vi.spyOn(window, "open").mockReturnValue(null);
  computedStyleSpy = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation(() => ({ position: H.config.computedPosition }) as CSSStyleDeclaration);
  document.body.innerHTML = "";
  window.location.hash = "";
  // Capture the document-level click handler start() installs, so its
  // composedPath-absent branch can be driven directly (happy-dom's dispatch
  // requires a real composedPath, so it can't be exercised through dispatch).
  const origAdd = document.addEventListener.bind(document);
  vi.spyOn(document, "addEventListener").mockImplementation(((
    type: string,
    cb: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "click") H.cap.clickHandler = cb as unknown as AnyFn;
    return origAdd(type, cb, opts);
  }) as typeof document.addEventListener);
  setChrome();
});

afterEach(() => {
  globalThis.chrome = previousChrome as typeof chrome;
  openSpy.mockRestore();
  computedStyleSpy.mockRestore();
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

describe("content boot (main.tsx)", () => {
  it("on-demand: stays asleep until the popup wakes the tab, then wires everything", async () => {
    H.config.settings = {
      backend: "rest",
      activation: "manual",
      highContrast: true,
      convexUrl: "https://x.convex.cloud",
      convexDeviceKey: "k",
    };
    await importMain();

    // main() announced dormancy and registered the status listener; start() did
    // NOT run yet (on-demand).
    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:state", state: "asleep" });
    expect(H.cap.onMessage).toBeTypeOf("function");
    expect(H.cap.scannerCb).toBeUndefined();

    // status query is answered "asleep" before activation.
    const beforeWake = vi.fn();
    H.cap.onMessage!({ type: "lasso:status" }, {}, beforeWake);
    expect(beforeWake).toHaveBeenCalledWith({ awake: false });

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
    // an unrelated message is ignored.
    H.cap.onMessage!({ type: "noise" }, {}, vi.fn());

    // highContrast marked the UI host.
    expect(H.fake.uiHost.host.getAttribute("data-hc")).toBe("");

    // ---- backend factory thunks (rest/dom/graphql) all construct ----
    H.cap.xlistThunks!.rest();
    H.cap.xlistThunks!.dom();
    H.cap.xlistThunks!.graphql();
    expect(H.fake.auth.credentials).toHaveBeenCalled(); // via the rest creds thunk
    expect(H.spy.RestXListApi).toHaveBeenCalled();
    expect(H.spy.DomXListApi).toHaveBeenCalled();
    expect(H.spy.GraphqlXListApi).toHaveBeenCalled();

    // ---- list-cache loader + picker memberships/recentIds thunks ----
    await H.cap.listCacheLoader!();
    expect(H.spy.fetchOwnedLists).toHaveBeenCalled();
    H.cap.pickerDeps!.recentIds(5);
    expect(H.fake.listUsage.recentIds).toHaveBeenCalledWith(5);
    await H.cap.pickerDeps!.memberships("alice");
    expect(H.spy.fetchMembershipListIds).toHaveBeenCalled();

    // ---- membership store built from the configured Convex creds ----
    expect(H.cap.membershipArgs![0]).toMatchObject({
      convexUrl: "https://x.convex.cloud",
      convexDeviceKey: "k",
    });
    expect(H.cap.membershipArgs![1]).toBe(H.spy.buildConvex);

    // ---- controller deps: quick actions, target, anchor, openUrl, owner ----
    const deps = H.cap.controllerDeps!;
    const quick = deps.quick as { mute: AnyFn; unmute: AnyFn; block: AnyFn; notInterested: AnyFn };
    await quick.mute("alice");
    await quick.unmute("alice");
    await quick.block("alice");
    const tweetForCaret = document.createElement("article");
    quick.notInterested(tweetForCaret);
    expect(H.spy.muteUser).toHaveBeenCalled();
    expect(H.spy.unmuteUser).toHaveBeenCalled();
    expect(H.spy.blockUser).toHaveBeenCalled();
    expect(H.fake.caret.notInterested).toHaveBeenCalledWith(tweetForCaret);

    (deps.openUrl as AnyFn)("https://example.com");
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
    (deps.currentOwner as AnyFn)();
    expect(H.spy.getCurrentAccount).toHaveBeenCalled();

    // target.author with no hover → getFocusedTweet (null) → null.
    const target = deps.target as { author: AnyFn; tweet: AnyFn };
    expect(target.author()).toBeNull();
    expect(target.tweet()).toBeNull();

    // anchorFor: a caret with a real rect clamps to the viewport; a zero rect → null.
    const anchorFor = deps.anchorFor as (el: Element) => unknown;
    const withCaret = document.createElement("div");
    const caret = document.createElement("div");
    caret.setAttribute("data-testid", "caret");
    caret.getBoundingClientRect = () =>
      ({ right: 100, bottom: 200, width: 10, height: 10, left: 90, top: 190 }) as DOMRect;
    withCaret.appendChild(caret);
    expect(anchorFor(withCaret)).toMatchObject({
      left: expect.any(Number),
      top: expect.any(Number),
    });
    expect(anchorFor(document.createElement("div"))).toBeNull(); // no caret, zero rect

    // ---- keyboard run, route sync, scanner onScan, health breakage ----
    H.cap.keyboardRun!("toggle-select-mode");
    expect(H.fake.controller.command).toHaveBeenCalledWith("toggle-select-mode");
    H.cap.routeCb!();
    expect(H.fake.filter.sync).toHaveBeenCalled();
    H.cap.scannerOpts!.onScan!(3, 1);
    expect(H.fake.health.record).toHaveBeenCalledWith(3, 1);
    H.cap.healthOnBreakage!();
    expect(H.fake.controller.reportBreakage).toHaveBeenCalled();

    // filter feature's scope predicate delegates to the route's isInScope.
    H.cap.filterDeps!.inScope();
    expect(H.spy.isInScope).toHaveBeenCalledWith(location.pathname);

    // ---- the App vnode handed to the UI host exposes a working openUrl ----
    const appVnode = H.fake.uiHost.render.mock.calls[0]![0] as { props: { openUrl: AnyFn } };
    appVnode.props.openUrl("https://app.example");
    expect(openSpy).toHaveBeenCalledWith("https://app.example", "_blank", "noopener");

    // ---- scanner callback drives classify + overlay injection ----
    const a = cellTweet({ avatar: true });
    H.cap.scannerCb!({ screenName: "a" }, a.article);
    expect(H.fake.filter.classify).toHaveBeenCalledWith(a.article);
    // overlay injected into the avatar; the OverlayBinding vnode wires onToggle.
    const overlayCall = H.spy.render.mock.calls.at(-1) as [
      { props: { onToggle: AnyFn; hovered: { value: unknown } } },
      unknown,
    ];
    overlayCall[0].props.onToggle();
    void overlayCall[0].props.hovered.value; // evaluate the hovered computed
    expect(H.fake.controller.toggleSelect).toHaveBeenCalled();
    // a second scan on the same article is a no-op (overlay already present).
    const renders = H.spy.render.mock.calls.length;
    H.cap.scannerCb!({ screenName: "a" }, a.article);
    expect(H.spy.render.mock.calls.length).toBe(renders);

    // non-static avatar position branch.
    H.config.computedPosition = "relative";
    H.cap.scannerCb!({ screenName: "a" }, cellTweet({ avatar: true }).article);
    // avatar-absent: anchor falls back to User-Name, then to the article itself.
    H.cap.scannerCb!({ screenName: "a" }, cellTweet({ userName: true }).article);
    H.cap.scannerCb!({ screenName: "a" }, cellTweet({}).article);

    // stubbed cell: overlay is skipped.
    H.config.stubbed = true;
    const stub = cellTweet({ avatar: true });
    const before = H.spy.render.mock.calls.length;
    H.cap.scannerCb!({ screenName: "a" }, stub.article);
    expect(H.spy.render.mock.calls.length).toBe(before); // no overlay rendered

    // ---- mousemove: hover tracking incl. the quoted-tweet outer-article walk ----
    const outer = cellTweet({ avatar: true }).article;
    const innerCell = document.createElement("div");
    const inner = document.createElement("article");
    inner.setAttribute("data-testid", "tweet");
    const innerChild = document.createElement("span");
    inner.appendChild(innerChild);
    innerCell.appendChild(inner);
    outer.appendChild(innerCell);
    innerChild.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    // now target.tweet resolves to the hovered (in-document) article.
    expect(target.tweet()).toBe(outer);
    expect(target.author()).toEqual({ screenName: "a" });
    // mousemove off any tweet clears the hover target.
    document.body.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    // ---- click handler: every guard branch on the real selection store ----
    const togglesBefore = H.fake.controller.toggleSelect.mock.calls.length;
    const sel = cellTweet({ avatar: true }).article;

    // select mode OFF → click ignored.
    sel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(togglesBefore);

    H.cap.selection!.setSelectMode(true);

    // origin inside the overlay check → ignored (the check handles itself).
    const overlayHost = document.createElement("span");
    overlayHost.setAttribute("data-lasso-overlay", "");
    const inOverlay = document.createElement("i");
    overlayHost.appendChild(inOverlay);
    document.body.appendChild(overlayHost);
    inOverlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // origin inside Lasso's own UI root → passes through.
    const root = document.createElement("div");
    root.id = "lasso-root";
    const inRoot = document.createElement("i");
    root.appendChild(inRoot);
    document.body.appendChild(root);
    inRoot.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // click off any tweet → nothing to toggle.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // click on a tweet whose author can't be extracted → ignored.
    H.spy.extractAuthor.mockReturnValueOnce(null);
    sel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(togglesBefore);

    // click on a real tweet author → toggles the selection (composedPath arm).
    sel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(togglesBefore + 1);

    // drive the handler with an event lacking composedPath → the `?.()`
    // short-circuit + `?? e.target` fallback, then a normal toggle.
    H.cap.clickHandler!({
      composedPath: undefined,
      target: sel,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    expect(H.fake.controller.toggleSelect.mock.calls.length).toBe(togglesBefore + 2);
  });

  it("auto activation boots immediately without a user wake", async () => {
    H.config.settings = { backend: "graphql", activation: "auto", highContrast: false };
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    expect(H.fake.controller.wake).not.toHaveBeenCalled(); // activatedByUser=false
    expect(sendMessage).toHaveBeenCalledWith({ type: "lasso:state", state: "awake" });
    // highContrast=false: the UI host is not marked.
    expect(H.fake.uiHost.host.hasAttribute("data-hc")).toBe(false);
    // overlay injection with highContrast off + non-avatar fallback path.
    H.config.computedPosition = "relative";
    H.cap.scannerCb!({ screenName: "a" }, cellTweet({ userName: true }).article);
  });

  it("forces the welcome card when the install hash is present", async () => {
    window.location.hash = "#lasso-welcome";
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    H.config.onboarded = true; // irrelevant: the hash wins
    const replace = vi.spyOn(window.history, "replaceState");
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
    expect(replace).toHaveBeenCalled(); // hash stripped after forcing the card
    replace.mockRestore();
  });

  it("shows the welcome card once for a not-yet-onboarded user", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    H.config.onboarded = false;
    await importMain();
    await vi.waitFor(() => expect(H.fake.coach.isOnboarded).toHaveBeenCalled());
  });

  it("skips the welcome card for an onboarded user (no hash)", async () => {
    H.config.settings = { backend: "rest", activation: "auto", highContrast: false };
    H.config.onboarded = true;
    await importMain();
    await vi.waitFor(() => expect(H.fake.scanner.start).toHaveBeenCalled());
  });

  it("survives a missing service worker (sendMessage + addListener throwing)", async () => {
    setChrome({ sendThrows: true, addThrows: true });
    H.config.settings = { backend: "rest", activation: "manual", highContrast: false };
    // Importing must not throw even though every chrome call blows up.
    await expect(importMain()).resolves.toBeUndefined();
  });

  it("logs and recovers when settings fail to load", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    H.fake.settings.get.mockRejectedValueOnce(new Error("storage dead"));
    await importMain();
    await vi.waitFor(() =>
      expect(err).toHaveBeenCalledWith("[Lasso] init failed", expect.any(Error)),
    );
    err.mockRestore();
  });
});
