const PAGE_ACTIVATE_CHANNEL = "__lasso_x_main_world_activate__";
const PAGE_ACTIVATE_REQUEST = "activate";
const PAGE_ACTIVATE_RESPONSE = "activated";
const PAGE_ACTIVATE_READY = "data-lasso-main-world-activate";
const PAGE_ACTIVATE_TARGET = "data-lasso-activate-target";

function activate(el: Element): void {
  const target = el as HTMLElement;

  // Scroll only when off-screen: re-centering a visible target jolts the
  // timeline and can scroll the page under the open #layers dropdown.
  const pre = target.getBoundingClientRect();
  if (pre.bottom < 0 || pre.top > window.innerHeight) {
    target.scrollIntoView?.({ block: "center", inline: "nearest" });
  }

  const rect = target.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button: 0,
  };

  const pointer = (type: string, buttons: number): void => {
    if (typeof PointerEvent === "function") {
      target.dispatchEvent(
        new PointerEvent(type, {
          ...base,
          buttons,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    }
  };
  const mouse = (type: string, buttons: number): void => {
    target.dispatchEvent(new MouseEvent(type, { ...base, buttons }));
  };

  pointer("pointerover", 0);
  mouse("mouseover", 0);
  pointer("pointerdown", 1);
  mouse("mousedown", 1);
  pointer("pointerup", 0);
  mouse("mouseup", 0);
  // exactly ONE click — a second one would re-toggle controls like the caret,
  // closing the menu that the first click just opened
  mouse("click", 0);
}

document.documentElement.setAttribute(PAGE_ACTIVATE_READY, "1");

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as {
    channel?: string;
    id?: string;
    requestId?: string;
    type?: string;
  } | null;
  if (
    data?.channel !== PAGE_ACTIVATE_CHANNEL ||
    data.type !== PAGE_ACTIVATE_REQUEST ||
    !data.id ||
    !data.requestId
  ) {
    return;
  }

  const target = [...document.querySelectorAll(`[${PAGE_ACTIVATE_TARGET}]`)].find(
    (el) => el.getAttribute(PAGE_ACTIVATE_TARGET) === data.id,
  );
  if (!target) {
    window.postMessage(
      {
        channel: PAGE_ACTIVATE_CHANNEL,
        ok: false,
        requestId: data.requestId,
        type: PAGE_ACTIVATE_RESPONSE,
      },
      "*",
    );
    return;
  }

  target.removeAttribute(PAGE_ACTIVATE_TARGET);
  activate(target);
  window.postMessage(
    {
      channel: PAGE_ACTIVATE_CHANNEL,
      ok: true,
      requestId: data.requestId,
      type: PAGE_ACTIVATE_RESPONSE,
    },
    "*",
  );
});
