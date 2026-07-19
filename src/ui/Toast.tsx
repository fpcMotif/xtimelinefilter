import type { ActiveToast, ToastStore } from "@/core/toast-store";
import { UI_LAYER } from "@/ui/layers";

import { useSignalValue } from "./use-signal-value";

/**
 * Toast stack, bottom-center (story beats 4–8). Success is X-blue; danger is
 * literal and persists with an explicit ✕. Actions render as pills with
 * optional keycap chips (Undo · Z).
 */
export function ToastHost({ store }: { store: ToastStore }) {
  const toasts = useSignalValue(store.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      class="fixed bottom-20 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ zIndex: UI_LAYER.app }}
    >
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

const KIND_CLASS: Record<ActiveToast["kind"], string> = {
  success: "bg-primary text-primary-foreground",
  info: "bg-foreground text-background",
  danger: "bg-destructive text-primary-foreground",
};

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
  return (
    <output
      role={toast.kind === "danger" ? "alert" : "status"}
      class={`${KIND_CLASS[toast.kind]} shadow-elevated flex max-w-[420px] items-center gap-3 rounded-2xl px-4 py-2.5 text-sm tabular-nums transition-[opacity,transform] duration-300 ease-out starting:translate-y-2 starting:opacity-0`}
    >
      <span class="flex min-w-0 flex-col">
        <span class="font-semibold">{toast.title}</span>
        {toast.line && <span class="opacity-90">{toast.line}</span>}
      </span>
      {toast.actions?.map((a, i) => (
        <button
          key={a.label}
          type="button"
          onClick={() => onAct(i)}
          class="flex shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 font-semibold transition-transform duration-150 ease-out outline-none hover:bg-white/30 focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.96]"
        >
          {a.label}
          {a.kbd && (
            <kbd class="text-2xs rounded border border-white/40 px-1 leading-4">{a.kbd}</kbd>
          )}
        </button>
      ))}
      {persistent && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          class="shrink-0 rounded-full px-1.5 leading-none opacity-80 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          ✕
        </button>
      )}
    </output>
  );
}
