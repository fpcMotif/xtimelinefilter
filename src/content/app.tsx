import type { ReadonlySignal } from "@preact/signals-core";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "preact/hooks";

import type { AppState } from "@/content/app-state";
import type { LassoController } from "@/content/controller";
import type { KeyBinding } from "@/content/keyboard";
import type { Coach } from "@/core/coach";
import type { FolderPickerController } from "@/core/folder-picker-controller";
import { keycaps, type Platform } from "@/core/keycaps";
import type { PickerController } from "@/core/picker-controller";
import type { SelectionStore, TweetAuthor } from "@/core/selection-store";
import { CREATE_LIST_URL, FIRST_HOVER_TIP, UNIT_TOOLTIP } from "@/core/strings";
import type { ToastStore } from "@/core/toast-store";
import { ActionBar } from "@/ui/ActionBar";
import { FolderPicker } from "@/ui/FolderPicker";
import { UI_LAYER } from "@/ui/layers";
import { ListPicker } from "@/ui/ListPicker";
import { ShortcutsSheet } from "@/ui/ShortcutsSheet";
import { ToastHost } from "@/ui/Toast";
import { TweetOverlay } from "@/ui/TweetOverlay";
import { useSignalValue } from "@/ui/use-signal-value";
import { WelcomeCard } from "@/ui/WelcomeCard";

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "transparent",
  },
  panel: {
    position: "fixed",
  },
});
export interface OverlayBindingProps {
  selection: SelectionStore;
  author: TweetAuthor;
  /** True while this post is under the pointer (drives the fade-in). */
  hovered: ReadonlySignal<boolean>;
  coach?: Coach;
  onToggle(): void;
  /** Opens Folder Picker for this post; optional so tests can omit it. */
  onSave?: () => void;
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
  onSave,
}: OverlayBindingProps) {
  useSignalValue(selection.count);
  const isHovered = useSignalValue(hovered);
  const selectMode = useSignalValue(selection.selectMode);
  const [focused, setFocused] = useState(false);
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    if ((!isHovered && !focused) || !coach) {
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
  }, [isHovered, focused, coach]);

  return (
    <TweetOverlay
      screenName={author.screenName}
      selected={selection.isSelected(author.screenName)}
      visible={isHovered || selectMode || focused}
      onToggle={onToggle}
      onSave={onSave}
      onFocusChange={setFocused}
      tooltip={tip}
    />
  );
}

export interface AppProps {
  selection: SelectionStore;
  appState: AppState;
  picker: PickerController;
  folderPicker: FolderPickerController;
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
  folderPicker,
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
  const folderPickerOpen = useSignalValue(appState.folderPickerOpen);
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

  // A review dialog without rows cannot restore useful state later. Clear it
  // as soon as the final selected author leaves, whatever caused the removal.
  useEffect(() => {
    if (count === 0) appState.reviewOpen.value = false;
  }, [appState, count]);

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
        <>
          <div
            aria-hidden="true"
            data-list-picker-backdrop
            {...stylex.props(styles.backdrop)}
            style={{ zIndex: UI_LAYER.modal }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              picker.act({ type: "close" });
              appState.pickerOpen.value = false;
            }}
          />
          <div
            data-list-picker-panel
            {...stylex.props(styles.panel)}
            style={{
              zIndex: UI_LAYER.modal,
              ...(pickerAnchor
                ? { left: `${pickerAnchor.left}px`, top: `${pickerAnchor.top}px` }
                : { bottom: "88px", left: "50%", transform: "translateX(-50%)" }),
            }}
          >
            <ListPicker
              picker={picker}
              onEffect={(effect) => void controller.pickerEffect(effect)}
              onCancel={() => {
                appState.pickerOpen.value = false;
              }}
              onCreateList={() => openUrl(CREATE_LIST_URL)}
            />
          </div>
        </>
      )}
      {folderPickerOpen && (
        <>
          <div
            aria-hidden="true"
            data-folder-picker-backdrop
            {...stylex.props(styles.backdrop)}
            style={{ zIndex: UI_LAYER.modal }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              folderPicker.act({ type: "close" });
              appState.folderPickerOpen.value = false;
            }}
          />
          <div
            data-folder-picker-panel
            {...stylex.props(styles.panel)}
            style={{
              zIndex: UI_LAYER.modal,
              ...(pickerAnchor
                ? { left: `${pickerAnchor.left}px`, top: `${pickerAnchor.top}px` }
                : { bottom: "88px", left: "50%", transform: "translateX(-50%)" }),
            }}
          >
            <FolderPicker
              picker={folderPicker}
              onEffect={(effect) => void controller.folderPickerEffect(effect)}
              onCancel={() => {
                appState.folderPickerOpen.value = false;
              }}
            />
          </div>
        </>
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
