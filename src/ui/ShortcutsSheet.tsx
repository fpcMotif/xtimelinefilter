import * as stylex from "@stylexjs/stylex";
import { useRef } from "preact/hooks";

import type { CommandId, KeyBinding } from "@/content/keyboard";
import { keycaps, type Platform } from "@/core/keycaps";
import { SHORTCUTS_FOOTER, SHORTCUTS_TITLE } from "@/core/strings";
import { Kbd } from "@/ui/components";
import { UI_LAYER } from "@/ui/layers";
import { tokens } from "@/ui/tokens.stylex";
import { useFocusTrap } from "@/ui/use-focus-trap";

export const COMMAND_LABELS: Record<CommandId, string> = {
  "add-to-list": "Add the author to a List",
  "add-to-default-list": "Add straight to your default List",
  "save-to-default-folder": "Save this post to your default Folder",
  "open-folder-picker": "Choose a Folder to save this post to",
  mute: "Mute the author",
  "not-interested": "Not interested in this post",
  block: "Block the author",
  "toggle-select": "Select the focused post (ss adds to a List)",
  "select-and-add-to-list": "Select and add to a List",
  "toggle-select-mode": "Select mode on / off",
  "toggle-filter": "Timeline filter on / off",
  "toggle-reveal": "Peek hidden posts / re-hide",
  help: "Show this sheet",
  escape: "Dismiss, one layer at a time",
  undo: "Undo the last action",
  "next-post": "Move to the next post",
  "previous-post": "Move to the previous post",
};

export interface ShortcutsSheetProps {
  /** The LIVE keymap — rebinds self-document (story beat 5). */
  keymap: KeyBinding[];
  platform: Platform;
  onClose(): void;
}

const styles = stylex.create({
  scrim: {
    backgroundColor: tokens.scrim,
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
  },
  dialog: {
    backgroundColor: tokens.card,
    color: tokens.cardForeground,
    boxShadow: tokens.shadowElevated,
    width: "380px",
    maxWidth: "calc(100vw - 32px)",
    borderRadius: tokens.radiusXl,
    padding: "1.5rem",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  title: {
    fontSize: tokens.textXl,
    fontWeight: "700",
    margin: 0,
  },
  closeButton: {
    color: tokens.mutedForeground,
    borderRadius: tokens.radiusFull,
    paddingLeft: "0.375rem",
    paddingRight: "0.375rem",
    lineHeight: 1,
    outline: "none",
    border: "none",
    background: "none",
    cursor: "pointer",
    ":hover": {
      color: tokens.foreground,
    },
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
  table: {
    marginTop: "1rem",
    width: "100%",
    borderCollapse: "collapse",
  },
  cellLabel: {
    fontSize: tokens.textMd,
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
  },
  cellKeys: {
    paddingTop: "0.375rem",
    paddingBottom: "0.375rem",
    textAlign: "right",
  },
  keysWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.125rem",
  },
  footer: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    marginTop: "1rem",
    borderTopWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    paddingTop: "0.75rem",
  },
});

/** `?` sheet: rendered from the live keymap, closed by Esc/?, trust footer.
    A true modal: focus is trapped inside and returned on close. */
export function ShortcutsSheet({ keymap, platform, onClose }: ShortcutsSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  return (
    <div {...stylex.props(styles.scrim)} style={{ zIndex: UI_LAYER.modal }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={SHORTCUTS_TITLE}
        {...stylex.props(styles.dialog)}
      >
        <div {...stylex.props(styles.header)}>
          <h2 {...stylex.props(styles.title)}>{SHORTCUTS_TITLE}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            {...stylex.props(styles.closeButton)}
          >
            ✕
          </button>
        </div>
        <table {...stylex.props(styles.table)}>
          <tbody>
            {keymap.map((binding) => (
              <tr key={binding.combo}>
                <td {...stylex.props(styles.cellLabel)}>{COMMAND_LABELS[binding.command]}</td>
                <td {...stylex.props(styles.cellKeys)}>
                  <span {...stylex.props(styles.keysWrap)}>
                    {keycaps(binding.combo, platform).map((cap) => (
                      <Kbd key={cap}>{cap}</Kbd>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p {...stylex.props(styles.footer)}>{SHORTCUTS_FOOTER}</p>
      </div>
    </div>
  );
}
