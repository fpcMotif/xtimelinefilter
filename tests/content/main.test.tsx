import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandId } from "@/content/keyboard";
import type { TweetAuthor } from "@/core/selection-store";
import type { LassoSettings } from "@/core/settings";

type MessageListener = (msg?: { type?: string }) => void;
type ScannerCallback = (author: TweetAuthor, article: Element) => void;

const author: TweetAuthor = { screenName: "jack", displayName: "Jack" };

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const makeTweet = (): HTMLElement => {
  const article = document.createElement("article");
  article.setAttribute("data-testid", "tweet");
  article.innerHTML = `
    <div data-testid="User-Name">
      <a href="/jack/status/1"><time>1h</time></a>
    </div>
    <button data-testid="caret"></button>`;
  return article;
};

interface Harness {
  appProps: () => Record<string, any>;
  blockUser: ReturnType<typeof vi.fn>;
  consoleError: ReturnType<typeof vi.spyOn>;
  consoleInfo: ReturnType<typeof vi.spyOn>;
  consoleWarn: ReturnType<typeof vi.spyOn>;
  createUiRoot: ReturnType<typeof vi.fn>;
  credentials: ReturnType<typeof vi.fn>;
  extractAuthor: ReturnType<typeof vi.fn>;
  fetchOwnedLists: ReturnType<typeof vi.fn>;
  focused: (tweet: Element | null) => void;
  message: MessageListener;
  muteUser: ReturnType<typeof vi.fn>;
  notInterested: ReturnType<typeof vi.fn>;
  overlayRender: ReturnType<typeof vi.fn>;
  run: (command: CommandId) => Promise<void>;
  scanner: ScannerCallback;
  shadowAttach: ReturnType<typeof vi.fn>;
}

async function loadMain(
  patch: Partial<LassoSettings> & { rejectSettings?: boolean } = {},
): Promise<Harness> {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = "";
  delete (window as unknown as { __lasso?: unknown }).__lasso;

  const settings: LassoSettings = {
    backend: patch.backend ?? "rest",
    hotkeySelectMode: "s",
    activation: patch.activation ?? "auto",
  };
  const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  let runCommand: ((command: CommandId) => void | Promise<void>) | undefined;
  let messageListener: MessageListener | undefined;
  let scannerCallback: ScannerCallback | undefined;
  let focusedTweet: Element | null = null;
  let appNode: { props?: Record<string, any> } | undefined;

  const overlayRender = vi.fn((node: { props?: Record<string, any> }, mount: Element) => {
    mount.textContent = node?.props?.author?.screenName ?? "rendered";
  });
  const rootRender = vi.fn((node: { props?: Record<string, any> }) => {
    appNode = node;
  });
  const shadowAttach = vi.fn((host: HTMLElement) => {
    const root = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    root.appendChild(mount);
    return { root, mount };
  });
  const createUiRoot = vi.fn(() => ({
    host: document.createElement("div"),
    root: document.createElement("div") as unknown as ShadowRoot,
    render: rootRender,
    destroy: vi.fn(),
  }));
  const fetchOwnedLists = vi.fn(async () => [{ id: "1", name: "Research" }]);
  const credentials = vi.fn(() => ({ csrf: "ct0", bearer: "bearer" }));
  const extractAuthor = vi.fn(() => author);
  const notInterested = vi.fn(async () => {});
  const muteUser = vi.fn(async () => {});
  const blockUser = vi.fn(async () => {});

  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    ...(previousChrome as typeof chrome),
    runtime: {
      ...previousChrome?.runtime,
      onMessage: { addListener: vi.fn((cb: MessageListener) => (messageListener = cb)) },
    },
  } as unknown as typeof chrome;
  window.fetch = vi.fn(async () => new Response("{}")) as unknown as typeof fetch;

  vi.doMock("preact", async (importOriginal) => {
    const actual = await importOriginal<typeof import("preact")>();
    return { ...actual, render: overlayRender };
  });
  vi.doMock("@/content/app", () => ({
    App: () => null,
    OverlayBinding: () => null,
  }));
  vi.doMock("@/content/get-focused-tweet", () => ({
    getFocusedTweet: vi.fn(() => focusedTweet),
  }));
  vi.doMock("@/content/keyboard", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/content/keyboard")>();
    return {
      ...actual,
      installKeyboardLayer: vi.fn(({ run }: { run: (command: CommandId) => void }) => {
        runCommand = run;
        return vi.fn();
      }),
    };
  });
  vi.doMock("@/content/tweet-scanner", () => ({
    createTweetScanner: vi.fn((_root: Document, cb: ScannerCallback) => {
      scannerCallback = cb;
      return { start: vi.fn(), stop: vi.fn(), scanExisting: vi.fn() };
    }),
  }));
  vi.doMock("@/core/settings", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/settings")>();
    return {
      ...actual,
      createSettings: vi.fn(() => ({
        get: vi.fn(async () => {
          if (patch.rejectSettings) throw new Error("settings failed");
          return settings;
        }),
      })),
    };
  });
  vi.doMock("@/core/tweet-extractor", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/tweet-extractor")>();
    return { ...actual, extractAuthor };
  });
  vi.doMock("@/core/x-client/auth", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/x-client/auth")>();
    return { ...actual, createDocumentAuth: vi.fn(() => ({ credentials })) };
  });
  vi.doMock("@/core/x-client/caret-actions", () => ({
    createCaretActions: vi.fn(() => ({ notInterested })),
  }));
  vi.doMock("@/core/x-client/lists-provider", () => ({ fetchOwnedLists }));
  vi.doMock("@/core/x-client/rest-api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/core/x-client/rest-api")>();
    return { ...actual, muteUser, blockUser };
  });
  vi.doMock("@/ui/mount", () => ({ attachShadowRoot: shadowAttach, createUiRoot }));

  await import("@/content/main");
  await flush();

  return {
    appProps: () => appNode?.props ?? {},
    blockUser,
    consoleError,
    consoleInfo,
    consoleWarn,
    createUiRoot,
    credentials,
    extractAuthor,
    fetchOwnedLists,
    focused: (tweet) => {
      focusedTweet = tweet;
    },
    message: (msg) => messageListener?.(msg),
    muteUser,
    notInterested,
    overlayRender,
    run: async (command) => {
      await runCommand?.(command);
      await flush();
    },
    scanner: (tweetAuthor, article) => scannerCallback?.(tweetAuthor, article),
    shadowAttach,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.innerHTML = "";
});

describe("content main", () => {
  it("auto-starts, injects overlays, loads lists, and runs every command path", async () => {
    const h = await loadMain({ activation: "auto", backend: "rest" });
    expect(h.consoleInfo).toHaveBeenCalledWith(
      "%c[Lasso] content script booted",
      "color:#1d9bf0;font-weight:bold",
      location.href,
    );
    expect((window as unknown as { __lasso?: { booted?: boolean } }).__lasso?.booted).toBe(true);
    expect(h.createUiRoot).toHaveBeenCalledTimes(1);

    const props = h.appProps();
    await props.listCache.lists({ force: true });
    expect(h.fetchOwnedLists).toHaveBeenCalledWith({
      fetch: expect.any(Function),
      creds: { csrf: "ct0", bearer: "bearer" },
    });
    await props.backend.addMember({ id: "L1", name: "Research" }, author);

    const article = makeTweet();
    const anchor = article.querySelector('[data-testid="User-Name"]') as HTMLElement;
    h.scanner(author, article);
    expect(anchor.querySelector("[data-lasso-overlay]")).toBeTruthy();
    expect(h.shadowAttach).toHaveBeenCalledTimes(1);
    expect(h.overlayRender).toHaveBeenCalledTimes(1);
    h.scanner(author, article);
    expect(h.shadowAttach).toHaveBeenCalledTimes(1);

    const bareArticle = document.createElement("article");
    h.scanner(author, bareArticle);
    expect(bareArticle.firstElementChild?.hasAttribute("data-lasso-overlay")).toBe(true);

    document.body.appendChild(article);
    h.focused(article);
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    await h.run("toggle-select-mode");
    expect(props.selection.selectMode.value).toBe(true);
    await h.run("toggle-select");
    expect(props.selection.isSelected("jack")).toBe(true);
    props.selection.clear();

    const tickBefore = props.openPickerTick.value;
    await h.run("add-to-list");
    expect(props.selection.isSelected("jack")).toBe(true);
    expect(props.openPickerTick.value).toBe(tickBefore + 1);
    await h.run("add-to-list");
    expect(props.selection.count.value).toBe(1);
    expect(props.openPickerTick.value).toBe(tickBefore + 2);

    await h.run("mute");
    await h.run("block");
    await h.run("not-interested");
    expect(h.muteUser).toHaveBeenCalledWith(expect.any(Object), "jack");
    expect(h.blockUser).toHaveBeenCalledWith(expect.any(Object), "jack");
    expect(h.notInterested).toHaveBeenCalledWith(article);

    h.extractAuthor.mockReturnValueOnce(null);
    await h.run("mute");
    expect(h.muteUser).toHaveBeenCalledTimes(1);

    h.notInterested.mockRejectedValueOnce(new Error("menu failed"));
    await h.run("not-interested");
    expect(h.consoleError).toHaveBeenCalledWith(
      "[Lasso] action failed:",
      "not-interested",
      expect.any(Error),
    );

    h.focused(null);
    const outer = makeTweet();
    const inner = makeTweet();
    outer.appendChild(inner);
    document.body.appendChild(outer);
    inner.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await h.run("toggle-select");
    expect(h.extractAuthor).toHaveBeenLastCalledWith(outer);

    outer.remove();
    await h.run("mute");
    expect(h.consoleWarn).toHaveBeenCalledWith(
      "[Lasso] hover a tweet (or press j to focus one) first",
    );
  });

  it("waits for on-demand activation and only starts once", async () => {
    const h = await loadMain({ activation: "on-demand", backend: "rest" });
    expect(h.createUiRoot).not.toHaveBeenCalled();

    h.message(undefined);
    h.message({ type: "other" });
    await flush();
    expect(h.createUiRoot).not.toHaveBeenCalled();

    h.message({ type: "lasso-activate" });
    await flush();
    expect(h.createUiRoot).toHaveBeenCalledTimes(1);

    h.message({ type: "lasso-activate" });
    await flush();
    expect(h.createUiRoot).toHaveBeenCalledTimes(1);
  });

  it("constructs DOM and GraphQL backends when configured", async () => {
    const dom = await loadMain({ activation: "auto", backend: "dom" });
    expect(dom.createUiRoot).toHaveBeenCalledTimes(1);

    const graphql = await loadMain({ activation: "auto", backend: "graphql" });
    expect(graphql.createUiRoot).toHaveBeenCalledTimes(1);
  });

  it("logs initialization failures", async () => {
    const h = await loadMain({ rejectSettings: true });
    expect(h.consoleError).toHaveBeenCalledWith("[Lasso] init failed", expect.any(Error));
    expect(h.createUiRoot).not.toHaveBeenCalled();
  });
});
