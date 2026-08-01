import { createAppState } from "@/content/app-state";
import { createCollectionsClient } from "@/content/collections-client";
import { createLassoController } from "@/content/controller";
import { installKeyboardLayer, type KeyBinding } from "@/content/keyboard";
import { NonXSurface } from "@/content/non-x-surface";
import {
  createSocialPostAdapter,
  createTimelineCursor,
  socialPlatformForHost,
  type SocialPlatform,
} from "@/content/social-posts";
import type { Coach } from "@/core/coach";
import { createFolderPickerController } from "@/core/folder-picker-controller";
import { createListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import { createSelectionStore } from "@/core/selection-store";
import { DEFAULT_SETTINGS, type SettingsStore } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import { createUndoRegistry } from "@/core/undo";
import type { XListApiSource } from "@/packages/x-client/types";
import { createUiRoot } from "@/ui/mount";

const KEYMAP: KeyBinding[] = [
  { combo: "j", command: "next-post" },
  { combo: "k", command: "previous-post" },
  { combo: "Alt+Shift+b", command: "save-to-default-folder" },
  { combo: "Alt+b", command: "open-folder-picker" },
  { combo: "Escape", command: "escape" },
];

const NOOP_SETTINGS: SettingsStore = {
  get: async () => DEFAULT_SETTINGS,
  set: async () => DEFAULT_SETTINGS,
  subscribe: () => () => {},
};

const NOOP_COACH: Coach = {
  isOnboarded: async () => true,
  markOnboarded: async () => {},
  recordAssign: async () => {},
  hintsActive: async () => false,
  tryShowTip: async () => false,
  replayIntro: async () => {},
};

const NOOP_BACKEND: XListApiSource = {
  snapshot: () => ({
    evidence: "server-response" as const,
    addMember: async () => {},
    removeMember: async () => {},
  }),
};

function anchorFor(article: Element): { left: number; top: number } | null {
  const rect = article.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const width = 320;
  return {
    left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 240)),
  };
}

function install(platform: SocialPlatform): () => void {
  const adapter = createSocialPostAdapter(platform);
  const cursor = createTimelineCursor(adapter);
  const selection = createSelectionStore();
  const app = createAppState(selection);
  const toasts = createToastStore();
  const undo = createUndoRegistry();
  const cache = createListCache(async () => []);
  const picker = createPickerController({ cache, currentOwner: () => null });
  const collections = createCollectionsClient();
  const folderPicker = createFolderPickerController({ collections });
  const controller = createLassoController({
    selection,
    app,
    picker,
    folderPicker,
    toasts,
    undo,
    coach: NOOP_COACH,
    backend: NOOP_BACKEND,
    cache,
    settings: NOOP_SETTINGS,
    collections,
    quick: {
      mute: async () => {},
      unmute: async () => {},
      notInterested: async () => "unavailable",
    },
    target: {
      author: () => null,
      tweet: () => cursor.current(),
    },
    capturePost: adapter.capture,
    anchorFor,
    openUrl: (url) => void window.open(url, "_blank", "noopener"),
  });

  const root = createUiRoot();
  root.render(
    <NonXSurface app={app} folderPicker={folderPicker} controller={controller} toasts={toasts} />,
  );

  const onMouseMove = (event: MouseEvent): void => {
    cursor.observePointer(event.target);
  };
  document.addEventListener("mousemove", onMouseMove, true);

  const disposeKeyboard = installKeyboardLayer({
    keymap: KEYMAP,
    run(command) {
      if (app.folderPickerOpen.value && command !== "escape") return true;
      if (command === "next-post") {
        cursor.move("next");
        return true;
      }
      if (command === "previous-post") {
        cursor.move("previous");
        return true;
      }
      return controller.command(command);
    },
    surfaces: {
      modalOpen: () => app.folderPickerOpen.value,
      paletteHotkey: () => null,
      togglePalette: () => false,
    },
  });

  return () => {
    disposeKeyboard();
    document.removeEventListener("mousemove", onMouseMove, true);
    root.destroy();
    controller.stopRun();
  };
}

function main(): void {
  const testPlatform = (window as unknown as { __lassoTestPlatform?: SocialPlatform })
    .__lassoTestPlatform;
  const platform = socialPlatformForHost(location.hostname) ?? testPlatform ?? null;
  if (!platform) return;
  const dispose = install(platform);
  window.addEventListener("pagehide", dispose, { once: true });
  (window as unknown as { __lasso?: unknown }).__lasso = {
    booted: true,
    platform,
    href: location.href,
  };
}

main();
