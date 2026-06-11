import type { CommandId, KeyBinding } from "@/content/keyboard";
import { keycaps, type Platform } from "@/core/keycaps";
import { SHORTCUTS_FOOTER, SHORTCUTS_TITLE } from "@/core/strings";

export const COMMAND_LABELS: Record<CommandId, string> = {
  "add-to-list": "Add the author to a List",
  "add-to-default-list": "Add straight to your default List",
  mute: "Mute the author",
  "not-interested": "Not interested in this post",
  block: "Block the author",
  "toggle-select": "Select the focused post",
  "toggle-select-mode": "Select mode on / off",
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

/** `?` sheet: rendered from the live keymap, closed by Esc/?, trust footer. */
export function ShortcutsSheet({ keymap, platform, onClose }: ShortcutsSheetProps) {
  return (
    <div
      class="fixed inset-0 z-[2147483646] grid place-items-center"
      style={{ background: "rgba(91, 112, 131, 0.4)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={SHORTCUTS_TITLE}
        class="bg-surface shadow-elevated w-[380px] max-w-[calc(100vw-32px)] rounded-2xl p-6"
      >
        <div class="flex items-start justify-between">
          <h2 class="text-ink text-[20px] font-bold">{SHORTCUTS_TITLE}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            class="text-muted hover:text-ink rounded-full px-1.5 leading-none"
          >
            ✕
          </button>
        </div>
        <table class="mt-4 w-full">
          <tbody>
            {keymap.map((binding) => (
              <tr key={binding.combo}>
                <td class="text-ink py-1.5 text-[15px]">{COMMAND_LABELS[binding.command]}</td>
                <td class="py-1.5 text-right">
                  <span class="inline-flex items-center gap-0.5">
                    {keycaps(binding.combo, platform).map((cap) => (
                      <kbd
                        key={cap}
                        class="border-line text-ink rounded border px-1.5 py-0.5 text-[12px] leading-4"
                      >
                        {cap}
                      </kbd>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="text-muted border-line mt-4 border-t pt-3 text-[13px]">{SHORTCUTS_FOOTER}</p>
      </div>
    </div>
  );
}
