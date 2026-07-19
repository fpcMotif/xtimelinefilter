import { useRef } from "preact/hooks";

import type { CommandId, KeyBinding } from "@/content/keyboard";
import { keycaps, type Platform } from "@/core/keycaps";
import { SHORTCUTS_FOOTER, SHORTCUTS_TITLE } from "@/core/strings";
import { Kbd } from "@/ui/components";
import { UI_LAYER } from "@/ui/layers";
import { useFocusTrap } from "@/ui/use-focus-trap";

export const COMMAND_LABELS: Record<CommandId, string> = {
  "add-to-list": "Add the author to a List",
  "add-to-default-list": "Add straight to your default List",
  mute: "Mute the author",
  "not-interested": "Not interested in this post",
  block: "Block the author",
  "toggle-select": "Select the focused post",
  "toggle-select-mode": "Select mode on / off",
  "toggle-filter": "Timeline filter on / off",
  "toggle-reveal": "Peek hidden posts / re-hide",
  help: "Show this sheet",
  escape: "Dismiss, one layer at a time",
  undo: "Undo the last action",
};

export interface ShortcutsSheetProps {
  /** The LIVE keymap — rebinds self-document (story beat 5). */
  keymap: KeyBinding[];
  platform: Platform;
  onClose(): void;
}

/** `?` sheet: rendered from the live keymap, closed by Esc/?, trust footer.
    A true modal: focus is trapped inside and returned on close. */
export function ShortcutsSheet({ keymap, platform, onClose }: ShortcutsSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  return (
    <div class="bg-scrim fixed inset-0 grid place-items-center" style={{ zIndex: UI_LAYER.modal }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={SHORTCUTS_TITLE}
        class="bg-card text-card-foreground shadow-elevated w-[380px] max-w-[calc(100vw-32px)] rounded-2xl p-6 transition-[opacity,transform] duration-300 ease-out starting:translate-y-2 starting:opacity-0"
      >
        <div class="flex items-start justify-between">
          <h2 class="text-[20px] font-bold">{SHORTCUTS_TITLE}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/55 rounded-full px-1.5 leading-none outline-none focus-visible:ring-2"
          >
            ✕
          </button>
        </div>
        <table class="mt-4 w-full">
          <tbody>
            {keymap.map((binding) => (
              <tr key={binding.combo}>
                <td class="text-md py-1.5">{COMMAND_LABELS[binding.command]}</td>
                <td class="py-1.5 text-right">
                  <span class="inline-flex items-center gap-0.5">
                    {keycaps(binding.combo, platform).map((cap) => (
                      <Kbd key={cap}>{cap}</Kbd>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="text-muted-foreground text-compact mt-4 border-t pt-3">{SHORTCUTS_FOOTER}</p>
      </div>
    </div>
  );
}
