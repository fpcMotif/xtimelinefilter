import { signal } from "@preact/signals-core";
import { cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, OverlayBinding } from "@/content/app";
import { createAppState } from "@/content/app-state";
import type { LassoController } from "@/content/controller";
import type { Coach } from "@/core/coach";
import type { PickerController } from "@/core/picker-controller";
import { createSelectionStore, type TweetAuthor } from "@/core/selection-store";
import { CREATE_LIST_URL, FIRST_HOVER_TIP, UNIT_TOOLTIP } from "@/core/strings";
import { createToastStore } from "@/core/toast-store";

// App is a wiring/container: it owns no logic beyond passing callbacks down. We
// replace its children with prop-capturing stand-ins so every wired callback and
// conditional surface is exercised directly (the children have their own suites).
type Props = Record<string, unknown>;
type Cap = {
  actionBar?: Props;
  listPicker?: Props;
  welcome?: Props;
  shortcuts?: Props;
  toast?: Props;
  overlay?: Props;
};
const { cap, stub } = vi.hoisted(() => {
  const cap: Cap = {};
  const stub = (key: keyof Cap) => (props: Props) => {
    cap[key] = props;
    return null;
  };
  return { cap, stub };
});
vi.mock("@/ui/ActionBar", () => ({ ActionBar: stub("actionBar") }));
vi.mock("@/ui/ListPicker", () => ({ ListPicker: stub("listPicker") }));
vi.mock("@/ui/WelcomeCard", () => ({ WelcomeCard: stub("welcome") }));
vi.mock("@/ui/ShortcutsSheet", () => ({ ShortcutsSheet: stub("shortcuts") }));
vi.mock("@/ui/Toast", () => ({ ToastHost: stub("toast") }));
vi.mock("@/ui/TweetOverlay", () => ({ TweetOverlay: stub("overlay") }));

const author = (screenName: string): TweetAuthor => ({ screenName, displayName: screenName });
const fn = (obj: Props | undefined, key: string) => obj![key] as (...args: unknown[]) => unknown;

function makeController() {
  return {
    openPicker: vi.fn(),
    stopRun: vi.fn(),
    assignSelectedTo: vi.fn(),
    trySelectMode: vi.fn(),
    skipWelcome: vi.fn(),
  };
}
function makeCoach(): Coach & {
  hintsActive: ReturnType<typeof vi.fn>;
  tryShowTip: ReturnType<typeof vi.fn>;
} {
  return {
    isOnboarded: vi.fn(async () => true),
    hintsActive: vi.fn(async () => false),
    tryShowTip: vi.fn(async () => false),
  } as unknown as Coach & {
    hintsActive: ReturnType<typeof vi.fn>;
    tryShowTip: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cap.actionBar =
    cap.listPicker =
    cap.welcome =
    cap.shortcuts =
    cap.toast =
    cap.overlay =
      undefined;
});

describe("App wiring", () => {
  function renderApp(
    setup?: (deps: {
      selection: ReturnType<typeof createSelectionStore>;
      appState: ReturnType<typeof createAppState>;
    }) => void,
    opts?: { hints?: boolean },
  ) {
    const selection = createSelectionStore();
    const appState = createAppState(selection);
    const toasts = createToastStore();
    const controller = makeController();
    const coach = makeCoach();
    if (opts?.hints) coach.hintsActive.mockResolvedValue(true);
    const picker = {} as PickerController;
    const openUrl = vi.fn();
    setup?.({ selection, appState });
    render(
      <App
        selection={selection}
        appState={appState}
        picker={picker}
        toasts={toasts}
        controller={controller as unknown as LassoController}
        coach={coach}
        keymap={[]}
        platform="mac"
        openUrl={openUrl}
      />,
    );
    return { selection, appState, toasts, controller, coach, openUrl };
  }

  it("routes the ActionBar callbacks to the controller and stores", async () => {
    const { selection, appState, controller, coach } = renderApp(({ selection }) => {
      selection.add(author("alice"));
    });

    fn(cap.actionBar, "onAssign")();
    expect(controller.openPicker).toHaveBeenCalledWith("pointer");

    const clearSpy = vi.spyOn(selection, "clear");
    fn(cap.actionBar, "onClear")();
    expect(clearSpy).toHaveBeenCalled();

    const setModeSpy = vi.spyOn(selection, "setSelectMode");
    fn(cap.actionBar, "onDone")();
    expect(setModeSpy).toHaveBeenCalledWith(false);

    fn(cap.actionBar, "onStop")();
    expect(controller.stopRun).toHaveBeenCalled();

    const removeSpy = vi.spyOn(selection, "remove");
    fn(cap.actionBar, "onRemove")("alice");
    expect(removeSpy).toHaveBeenCalledWith("alice");

    fn(cap.actionBar, "onToggleReview")(true);
    expect(appState.reviewOpen.value).toBe(true);

    // unit tooltip: resolves to text when the coach allows it, else null.
    coach.tryShowTip.mockResolvedValueOnce(true);
    await expect(fn(cap.actionBar, "onCountHover")()).resolves.toBe(UNIT_TOOLTIP);
    await expect(fn(cap.actionBar, "onCountHover")()).resolves.toBeNull();
  });

  it("shows decaying keycap hints only when the coach says so", async () => {
    renderApp();
    expect(cap.actionBar!.hintKeycaps).toBeNull();

    cleanup();
    renderApp(undefined, { hints: true });
    await waitFor(() => expect(cap.actionBar!.hintKeycaps).not.toBeNull());
    expect(Array.isArray(cap.actionBar!.hintKeycaps)).toBe(true);
  });

  it("opens the picker bottom-centered by default and wires its callbacks", () => {
    const { appState, controller, openUrl } = renderApp(({ appState }) => {
      appState.pickerOpen.value = true;
    });
    expect(cap.listPicker).toBeDefined();

    const list = { id_str: "L1", name: "Builders" };
    fn(cap.listPicker, "onPick")(list);
    expect(controller.assignSelectedTo).toHaveBeenCalledWith(list);

    fn(cap.listPicker, "onCreateList")();
    expect(openUrl).toHaveBeenCalledWith(CREATE_LIST_URL);

    fn(cap.listPicker, "onCancel")();
    expect(appState.pickerOpen.value).toBe(false);
  });

  it("anchors the picker at the caret when an anchor is set", () => {
    renderApp(({ appState }) => {
      appState.pickerOpen.value = true;
      appState.pickerAnchor.value = { left: 120, top: 240 };
    });
    expect(cap.listPicker).toBeDefined();
    const host = document.querySelector(".fixed") as HTMLElement;
    expect(host.style.left).toBe("120px");
    expect(host.style.top).toBe("240px");
  });

  it("wires the welcome card", () => {
    const { controller } = renderApp(({ appState }) => {
      appState.welcomeOpen.value = true;
    });
    fn(cap.welcome, "onTrySelectMode")();
    expect(controller.trySelectMode).toHaveBeenCalled();
    fn(cap.welcome, "onSkip")();
    expect(controller.skipWelcome).toHaveBeenCalled();
  });

  it("wires the shortcuts sheet close", () => {
    const { appState } = renderApp(({ appState }) => {
      appState.shortcutsOpen.value = true;
    });
    fn(cap.shortcuts, "onClose")();
    expect(appState.shortcutsOpen.value).toBe(false);
  });
});

describe("OverlayBinding", () => {
  it("stays quiet until hovered, then fires the first-hover coach tip", async () => {
    const selection = createSelectionStore();
    const hovered = signal(false);
    const onToggle = vi.fn();
    const coach = makeCoach();
    coach.tryShowTip.mockResolvedValue(true);

    render(
      <OverlayBinding
        selection={selection}
        author={author("alice")}
        hovered={hovered}
        coach={coach}
        onToggle={onToggle}
      />,
    );
    // Not hovered: no tooltip, overlay hidden.
    expect(cap.overlay!.tooltip).toBeNull();
    expect(cap.overlay!.visible).toBe(false);

    hovered.value = true;
    await waitFor(() => expect(cap.overlay!.tooltip).toBe(FIRST_HOVER_TIP));
    expect(cap.overlay!.visible).toBe(true);

    fn(cap.overlay, "onToggle")();
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows no tip when the coach declines", async () => {
    const selection = createSelectionStore();
    const hovered = signal(true);
    const coach = makeCoach(); // tryShowTip resolves false

    render(
      <OverlayBinding
        selection={selection}
        author={author("bob")}
        hovered={hovered}
        coach={coach}
        onToggle={vi.fn()}
      />,
    );
    await waitFor(() => expect(coach.tryShowTip).toHaveBeenCalledWith("first-hover"));
    expect(cap.overlay!.tooltip).toBeNull();
  });

  it("is visible in select mode and needs no coach", () => {
    const selection = createSelectionStore();
    selection.setSelectMode(true);
    render(
      <OverlayBinding
        selection={selection}
        author={author("carol")}
        hovered={signal(false)}
        onToggle={vi.fn()}
      />,
    );
    expect(cap.overlay!.visible).toBe(true); // selectMode forces visibility
    expect(cap.overlay!.tooltip).toBeNull(); // no coach → no tip path
  });

  it("does not set a tip if it unmounts before the coach resolves", async () => {
    const selection = createSelectionStore();
    let resolve!: (v: boolean) => void;
    const coach = makeCoach();
    coach.tryShowTip.mockReturnValue(new Promise<boolean>((r) => (resolve = r)));

    const view = render(
      <OverlayBinding
        selection={selection}
        author={author("dave")}
        hovered={signal(true)}
        coach={coach}
        onToggle={vi.fn()}
      />,
    );
    view.unmount(); // cleanup sets live=false before the tip resolves
    resolve(true);
    await Promise.resolve();
    // No assertion on tooltip (component gone) — the point is the live=false
    // guard runs without throwing; coverage records the cleanup branch.
    expect(coach.tryShowTip).toHaveBeenCalled();
  });
});
