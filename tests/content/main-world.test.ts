import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// main-world.ts is the MAIN-world activator injected at document_start: it has
// no exports, it registers a window "message" listener and marks the page ready
// on import. We capture that listener via an addEventListener spy so we can
// drive every branch synchronously, and spy on postMessage to read the reply.
const CHANNEL = "__lasso_x_main_world_activate__";
const READY_ATTR = "data-lasso-main-world-activate";
const TARGET_ATTR = "data-lasso-activate-target";

type MessageLike = { source: unknown; data: unknown };
type Listener = (event: MessageLike) => void;

let postSpy: ReturnType<typeof vi.spyOn>;

async function loadListener(): Promise<Listener> {
  let captured: Listener | undefined;
  const addSpy = vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    cb: unknown,
  ) => {
    if (type === "message") captured = cb as Listener;
  }) as typeof window.addEventListener);
  vi.resetModules();
  await import("@/content/main-world");
  addSpy.mockRestore();
  if (!captured) throw new Error("message listener was not registered");
  return captured;
}

function request(extra: Record<string, unknown>): MessageLike {
  return {
    source: window,
    data: { channel: CHANNEL, type: "activate", ...extra },
  };
}

function makeTarget(id: string, rect: Partial<DOMRect>): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute(TARGET_ATTR, id);
  el.getBoundingClientRect = () =>
    ({ top: 10, bottom: 20, left: 0, right: 0, width: 0, height: 0, ...rect }) as DOMRect;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(READY_ATTR);
  postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("main-world activator", () => {
  it("marks the page ready on import", async () => {
    await loadListener();
    expect(document.documentElement.getAttribute(READY_ATTR)).toBe("1");
  });

  it("activates a visible target with one click and replies ok", async () => {
    const listener = await loadListener();
    const target = makeTarget("abc", { top: 10, bottom: 20 });
    const clicks = vi.fn();
    target.addEventListener("click", clicks);

    listener(request({ id: "abc", requestId: "r1" }));

    expect(clicks).toHaveBeenCalledTimes(1); // exactly one click — never re-toggles
    expect(target.scrollIntoView).not.toHaveBeenCalled(); // on-screen: no jolt
    expect(target.hasAttribute(TARGET_ATTR)).toBe(false); // consumed
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL, ok: true, requestId: "r1", type: "activated" }),
      "*",
    );
  });

  it("scrolls an off-screen target into view before activating", async () => {
    const listener = await loadListener();
    const target = makeTarget("up", { top: -80, bottom: -50 }); // above the viewport

    listener(request({ id: "up", requestId: "r2" }));

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, requestId: "r2" }),
      "*",
    );
  });

  it("works without PointerEvent (dispatches only mouse events)", async () => {
    const listener = await loadListener();
    const target = makeTarget("noptr", { top: 10, bottom: 20 });
    const clicks = vi.fn();
    target.addEventListener("click", clicks);

    const savedPointer = globalThis.PointerEvent;
    // @ts-expect-error — simulate a runtime without PointerEvent.
    delete globalThis.PointerEvent;
    try {
      listener(request({ id: "noptr", requestId: "r3" }));
    } finally {
      globalThis.PointerEvent = savedPointer;
    }

    expect(clicks).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, requestId: "r3" }),
      "*",
    );
  });

  it("replies ok:false when no target carries the requested id", async () => {
    const listener = await loadListener();
    makeTarget("present", { top: 10, bottom: 20 });

    listener(request({ id: "absent", requestId: "r4" }));

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: CHANNEL, ok: false, requestId: "r4", type: "activated" }),
      "*",
    );
  });

  it("ignores messages from another window", async () => {
    const listener = await loadListener();
    listener({ source: {}, data: { channel: CHANNEL, type: "activate", id: "x", requestId: "r" } });
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("ignores messages on the wrong channel", async () => {
    const listener = await loadListener();
    listener({
      source: window,
      data: { channel: "other", type: "activate", id: "x", requestId: "r" },
    });
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("ignores a malformed request missing the requestId", async () => {
    const listener = await loadListener();
    listener(request({ id: "abc" }));
    expect(postSpy).not.toHaveBeenCalled();
  });
});
