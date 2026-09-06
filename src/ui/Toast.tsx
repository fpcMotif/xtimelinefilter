import * as stylex from "@stylexjs/stylex";

import type { ActiveToast, ToastStore } from "@/core/toast-store";
import { UI_LAYER } from "@/ui/layers";
import { tokens } from "@/ui/tokens.stylex";

import { useSignalValue } from "./use-signal-value";

const styles = stylex.create({
  host: {
    position: "fixed",
    bottom: "5rem",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0.5rem",
  },
  toast: {
    boxShadow: tokens.shadowElevated,
    display: "flex",
    maxWidth: "420px",
    alignItems: "center",
    gap: "0.75rem",
    borderRadius: tokens.radiusXl,
    paddingLeft: "1rem",
    paddingRight: "1rem",
    paddingTop: "0.625rem",
    paddingBottom: "0.625rem",
    fontSize: tokens.textSm,
    fontVariantNumeric: "tabular-nums",
    boxSizing: "border-box",
  },
  success: {
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  info: {
    backgroundColor: tokens.foreground,
    color: tokens.background,
  },
  danger: {
    backgroundColor: tokens.destructive,
    color: tokens.primaryForeground,
  },
  content: {
    display: "flex",
    minWidth: 0,
    flexDirection: "column",
  },
  title: {
    fontWeight: "600",
  },
  line: {
    opacity: 0.9,
  },
  actionButton: {
    display: "flex",
    flexShrink: 0,
    alignItems: "center",
    gap: "0.375rem",
    borderRadius: tokens.radiusFull,
    backgroundColor: {
      default: "rgba(255, 255, 255, 0.2)",
      ":hover": "rgba(255, 255, 255, 0.3)",
    },
    color: "inherit",
    paddingLeft: "0.75rem",
    paddingRight: "0.75rem",
    paddingTop: "0.25rem",
    paddingBottom: "0.25rem",
    fontWeight: "600",
    transitionProperty: "transform, background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    borderWidth: 0,
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.7)",
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
  kbd: {
    fontSize: tokens.text2xs,
    borderRadius: tokens.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(255, 255, 255, 0.4)",
    paddingLeft: "0.25rem",
    paddingRight: "0.25rem",
    lineHeight: "1rem",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  dismissButton: {
    flexShrink: 0,
    borderRadius: tokens.radiusFull,
    paddingLeft: "0.375rem",
    paddingRight: "0.375rem",
    lineHeight: 1,
    opacity: {
      default: 0.8,
      ":hover": 1,
    },
    outline: "none",
    borderWidth: 0,
    background: "none",
    color: "inherit",
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.7)",
    },
  },
});

/**
 * Toast stack, bottom-center (story beats 4–8). Success is X-blue; danger is
 * literal and persists with an explicit ✕. Actions render as pills with
 * optional keycap chips (Undo · Z).
 */
export function ToastHost({ store }: { store: ToastStore }) {
  const toasts = useSignalValue(store.toasts);
  if (toasts.length === 0) return null;
  return (
    <div {...stylex.props(styles.host)} style={{ zIndex: UI_LAYER.app }}>
      {toasts.map((t) => (
        <ToastView
          key={t.id}
          toast={t}
          onAct={(i) => store.act(t.id, i)}
          onDismiss={() => store.dismiss(t.id)}
        />
      ))}
    </div>
  );
}

export function ToastView({
  toast,
  onAct,
  onDismiss,
}: {
  toast: ActiveToast;
  onAct: (actionIndex: number) => void;
  onDismiss: () => void;
}) {
  const persistent = toast.durationMs === null || toast.kind === "danger";
  const kindStyle =
    toast.kind === "danger" ? styles.danger : toast.kind === "info" ? styles.info : styles.success;

  return (
    <output
      role={toast.kind === "danger" ? "alert" : "status"}
      {...stylex.props(styles.toast, kindStyle)}
    >
      <span {...stylex.props(styles.content)}>
        <span {...stylex.props(styles.title)}>{toast.title}</span>
        {toast.line && <span {...stylex.props(styles.line)}>{toast.line}</span>}
      </span>
      {toast.actions?.map((a, i) => (
        <button
          key={a.label}
          type="button"
          onClick={() => onAct(i)}
          {...stylex.props(styles.actionButton)}
        >
          {a.label}
          {a.kbd && <kbd {...stylex.props(styles.kbd)}>{a.kbd}</kbd>}
        </button>
      ))}
      {persistent && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          {...stylex.props(styles.dismissButton)}
        >
          ✕
        </button>
      )}
    </output>
  );
}
