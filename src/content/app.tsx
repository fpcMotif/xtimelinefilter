import type { ReadonlySignal } from "@preact/signals-core";
import { useEffect, useState } from "preact/hooks";

import type { AppState } from "@/content/app-state";
import type { LassoController } from "@/content/controller";
import type { KeyBinding } from "@/content/keyboard";
import type { Coach } from "@/core/coach";
import { keycaps, type Platform } from "@/core/keycaps";
import type { PickerController } from "@/core/picker-controller";
import type { SelectionStore, TweetAuthor } from "@/core/selection-store";
import { CREATE_LIST_URL, FIRST_HOVER_TIP, pickerHeader, UNIT_TOOLTIP } from "@/core/strings";
import type { ToastStore } from "@/core/toast-store";
import { ActionBar } from "@/ui/ActionBar";
import { ListPicker } from "@/ui/ListPicker";
import { ShortcutsSheet } from "@/ui/ShortcutsSheet";
import { ToastHost } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";
import { useSignalValue } from "@/ui/use-signal-value";
import { WelcomeCard } from "@/ui/WelcomeCard";

export interface OverlayBindingProps {
  selection: SelectionStore;
  author: TweetAuthor;
  /** True while this post is under the pointer (drives the fade-in). */
  hovered: ReadonlySignal<boolean>;
  coach?: Coach;
  onToggle(): void;
}

/**
 * Per-post overlay bound to the shared selection store. Hidden by default
 * (the timeline stays pristine); fades in on hover and in select mode; the
 * first hover ever fires the one-time coach tooltip (story beat 4).
 */
export function OverlayBinding({
  selection,
  author,
  hovered,
  coach,
  onToggle,
}: OverlayBindingProps) {
  useSignalValue(selection.count);
  const isHovered = useSignalValue(hovered);
  const selectMode = useSignalValue(selection.selectMode);
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    if (!isHovered || !coach) {
      setTip(null);
      return undefined;
    }
    let live = true;
    void coach.tryShowTip("first-hover").then((show) => {
      if (show && live) setTip(FIRST_HOVER_TIP);
    });
    return () => {
      live = false;
    };
  }, [isHovered, coach]);

  return (
    <TweetOverlay
      selected={selection.isSelected(author.screenName)}
      visible={isHovered || selectMode}
      onToggle={onToggle}
      tooltip={tip}
    />
  );
}

export interface AppProps {
  selection: SelectionStore;
  appState: AppState;
  picker: PickerController;
  toasts: ToastStore;
  controller: LassoController;
  coach: Coach;
  keymap: KeyBinding[];
  platform: Platform;
  openUrl(url: string): void;
}

/** The top-level UI: action bar, picker, welcome card, shortcuts sheet, toasts. */
export function App({
  selection,
  appState,
  picker,
  toasts,
  controller,
  coach,
  keymap,
  platform,
  openUrl,
}: AppProps) {
  const count = useSignalValue(selection.count);
  const selectMode = useSignalValue(selection.selectMode);
  const running = useSignalValue(appState.running);
  const pickerOpen = useSignalValue(appState.pickerOpen);
  const pickerAnchor = useSignalValue(appState.pickerAnchor);
  const reviewOpen = useSignalValue(appState.reviewOpen);
  const welcomeOpen = useSignalValue(appState.welcomeOpen);
  const shortcutsOpen = useSignalValue(appState.shortcutsOpen);

  // Decaying keycap hints (7 days or 5 assigns); re-checked after every run.
  const [hints, setHints] = useState(false);
  useEffect(() => {
    let live = true;
    void coach.hintsActive().then((on) => {
      if (live) setHints(on);
    });
    return () => {
      live = false;
    };
  }, [coach, running]);

  const authors = selection.list();
  void count; // count subscription re-renders the authors list above

  return (
    <>
      <ActionBar
        authors={authors}
        selectMode={selectMode}
        running={running}
        reviewOpen={reviewOpen}
        hintKeycaps={hints ? keycaps("Alt+l", platform) : null}
        onAssign={() => controller.openPicker("pointer")}
        onClear={() => selection.clear()}
        onDone={() => selection.setSelectMode(false)}
        onStop={() => controller.stopRun()}
        onRemove={(screenName) => selection.remove(screenName)}
        onToggleReview={(open) => {
          appState.reviewOpen.value = open;
        }}
        onCountHover={async () => ((await coach.tryShowTip("unit", 3)) ? UNIT_TOOLTIP : null)}
      />
      {pickerOpen && (
        <div
          class="fixed z-[2147483646]"
          style={
            pickerAnchor
              ? { left: `${pickerAnchor.left}px`, top: `${pickerAnchor.top}px` }
              : { bottom: "88px", left: "50%", transform: "translateX(-50%)" }
          }
        >
          <ListPicker
            picker={picker}
            header={pickerHeader(authors)}
            selectedCount={authors.length}
            onPick={(list) => void controller.assignSelectedTo(list)}
            onCancel={() => {
              appState.pickerOpen.value = false;
            }}
            onCreateList={() => openUrl(CREATE_LIST_URL)}
          />
        </div>
      )}
      {welcomeOpen && (
        <WelcomeCard
          onTrySelectMode={() => controller.trySelectMode()}
          onSkip={() => controller.skipWelcome()}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsSheet
          keymap={keymap}
          platform={platform}
          onClose={() => {
            appState.shortcutsOpen.value = false;
          }}
        />
      )}
      <ToastHost store={toasts} />
    </>
  );
}
