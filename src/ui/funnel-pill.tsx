import { useEffect, useRef, useState } from "preact/hooks";

import { activeCriteriaCount } from "@/core/filter-projection";
import type { FilterStore } from "@/core/filter-store";
import { FilterPanel } from "@/ui/filter-panel";
import { UI_LAYER } from "@/ui/layers";
import { useSignalValue } from "@/ui/use-signal-value";

const PILL_SIZE = 44;
const POPOVER_W = 320;
const POPOVER_GAP = 8;
const KEYBOARD_STEP = 8;
const KEYBOARD_FAST_STEP = 32;
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

type Position = { x: number; y: number };

export interface FunnelPillProps {
  store: FilterStore;
  hiddenCount: () => number;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Conduct in-page Filter commands through the controller's fail-open wall (passed to the panel). */
  conduct?: (run: (s: FilterStore) => void) => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function positionsEqual(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

function viewport(): { w: number; h: number } {
  const w = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1024;
  const h = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 768;
  return { w, h };
}

/**
 * Default surface: a draggable floating funnel pill that hosts the shared
 * <FilterPanel> in an anchored popover. Position comes from props (persisted by
 * the surface manager) and drags report back via onPositionChange, clamped to
 * the viewport. The popover anchors to the pill and flips to stay on screen,
 * closing on Escape / outside-click. When the master filter is off the pill
 * dims and its badge clears. No innerHTML of page data (ADR-0003).
 */
export function FunnelPill({
  store,
  hiddenCount,
  position,
  onPositionChange,
  open,
  onOpenChange,
  conduct,
}: FunnelPillProps) {
  const state = useSignalValue(store.state);
  const [pos, setPos] = useState(position);
  const posRef = useRef<Position>(position);
  const rootRef = useRef<HTMLDivElement>(null);
  const disposeDrag = useRef<(() => void) | null>(null);
  const keyboardMove = useRef<{ start: Position; last: Position } | null>(null);
  // A drag's bookkeeping lives in the pointerdown closure; pointerup latches its
  // `moved` flag here so the trailing synthetic click can tell a drag from a tap.
  const suppressClick = useRef(false);

  // Keep local position in sync when the caller hands us a new persisted value.
  useEffect(() => {
    const next = { x: position.x, y: position.y };
    // The parent owns persisted position. Do not let a stale, uncommitted key
    // sequence overwrite an external settings update.
    keyboardMove.current = null;
    posRef.current = next;
    setPos(next);
  }, [position.x, position.y]);

  useEffect(() => () => disposeDrag.current?.(), []);

  function setLocalPosition(next: Position): void {
    posRef.current = next;
    setPos(next);
  }

  function commitKeyboardMove(): void {
    const move = keyboardMove.current;
    keyboardMove.current = null;
    if (move && !positionsEqual(move.start, move.last)) {
      onPositionChange(move.last);
    }
  }

  // The keyboard layer owns Escape. This component only handles pointer dismissal.
  useEffect(() => {
    if (!open) return;
    const onOutside = (e: Event) => {
      // `onOutside` is only registered while the popover is open and rendered, so
      // the ref is always attached here.
      const root = rootRef.current as HTMLDivElement;
      // In production the pill lives in a Shadow DOM; a mousedown crossing the
      // shadow boundary retargets e.target to the shadow host, which is outside
      // `root`. Use the composed path (which still contains `root`) so clicks on
      // chips/checkboxes inside the popover are not treated as outside-clicks.
      const path = (e as Event).composedPath?.() ?? [];
      const host = (root.getRootNode() as ShadowRoot)?.host as Node | undefined;
      const inside =
        path.includes(root) || (!!host && path.includes(host)) || root.contains(e.target as Node);
      if (path.length > 0 && !inside) onOpenChange(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open, onOpenChange]);

  function onPointerDown(e: PointerEvent) {
    disposeDrag.current?.();
    const start = posRef.current;
    const drag = {
      dx: e.clientX - start.x,
      dy: e.clientY - start.y,
      moved: false,
      last: start,
    };
    const onMove = (ev: PointerEvent) => {
      const { w, h } = viewport();
      const next = {
        x: clamp(ev.clientX - drag.dx, 0, Math.max(0, w - PILL_SIZE)),
        y: clamp(ev.clientY - drag.dy, 0, Math.max(0, h - PILL_SIZE)),
      };
      if (!positionsEqual(next, drag.last)) drag.moved = true;
      drag.last = next;
      setLocalPosition(next); // live position is local state only — no persistence per move
    };
    let disposed = false;
    const dispose = () => {
      /* v8 ignore next -- re-entrancy guard: each dispose removes all pointer listeners and clears disposeDrag.current, so the same closure is never invoked twice */
      if (disposed) return;
      disposed = true;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      // A new drag disposes the prior one before claiming disposeDrag, so this
      /* v8 ignore next -- closure always owns disposeDrag when it runs; mismatch arm is dead */
      if (disposeDrag.current === dispose) disposeDrag.current = null;
    };
    const onUp = () => {
      dispose();
      suppressClick.current = drag.moved;
      // Persist ONCE on drop. onPositionChange writes chrome.storage.sync, which
      // Chrome caps at ~120 writes/min — reporting every pointermove burned the
      // whole quota in one drag and made every later settings/filter write fail
      // silently for minutes (the felt "state latency").
      if (drag.moved) onPositionChange(drag.last);
    };
    const onCancel = () => dispose();
    disposeDrag.current = dispose;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }

  function onClick() {
    // Suppress the click that ends a drag so dragging never toggles the popover.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpenChange(!open);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const direction = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    }[event.key];
    if (!direction) return;

    // Arrow keys reposition the pill, not the document. Stop here so X and
    // Lasso's document keyboard layer never interpret the same interaction.
    event.preventDefault();
    event.stopPropagation();

    const { w, h } = viewport();
    const step = event.shiftKey ? KEYBOARD_FAST_STEP : KEYBOARD_STEP;
    const current = posRef.current;
    const next = {
      x: clamp(current.x + direction.x * step, 0, Math.max(0, w - PILL_SIZE)),
      y: clamp(current.y + direction.y * step, 0, Math.max(0, h - PILL_SIZE)),
    };
    if (positionsEqual(current, next)) return;

    const move = keyboardMove.current ?? {
      start: current,
      last: current,
    };
    move.last = next;
    keyboardMove.current = move;
    setLocalPosition(next);
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (!ARROW_KEYS.has(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    commitKeyboardMove();
  }

  const enabled = state.enabled;
  const armed = activeCriteriaCount(state);
  const badge = enabled ? armed : 0;
  const accessibleName = `Timeline filter, ${enabled ? "on" : "off"}, ${armed} ${armed === 1 ? "filter" : "filters"} armed`;
  const popover = open ? popoverStyle(pos) : null;

  return (
    <div
      ref={rootRef}
      data-funnel-pill-root=""
      class="fixed"
      style={{ left: `${pos.x}px`, top: `${pos.y}px`, zIndex: UI_LAYER.pill }}
    >
      <button
        type="button"
        aria-label={accessibleName}
        aria-describedby="lasso-funnel-pill-keyboard-help"
        aria-expanded={open}
        data-enabled={String(enabled)}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={commitKeyboardMove}
        class="bg-card text-card-foreground shadow-elevated focus-visible:ring-ring/55 relative grid h-11 w-11 place-items-center rounded-full transition-[opacity,transform] duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
        style={{
          opacity: enabled ? 1 : 0.5,
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <FunnelGlyph />
        {enabled && badge > 0 && (
          <span
            aria-hidden="true"
            class="bg-primary text-primary-foreground text-2xs absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 font-semibold tabular-nums"
          >
            {badge}
          </span>
        )}
      </button>
      <span id="lasso-funnel-pill-keyboard-help" class="sr-only">
        Use Arrow keys to move the filter button. Hold Shift to move faster.
      </span>

      {popover && (
        <div
          role="dialog"
          aria-label="Timeline filter"
          class="bg-card shadow-elevated absolute w-80 overflow-hidden rounded-2xl transition-[opacity,transform] duration-150 ease-out starting:translate-y-1 starting:opacity-0"
          style={popover}
        >
          <FilterPanel store={store} hiddenCount={hiddenCount} conduct={conduct} />
        </div>
      )}
    </div>
  );
}

/**
 * Position the popover relative to the pill, flipping its anchor so it stays
 * within the viewport. The popover is a child of the (fixed) pill root, so we
 * anchor it with top/left when there is room below/right, and flip to
 * bottom/right when the pill sits near the viewport's bottom/right edges.
 */
function popoverStyle(pos: { x: number; y: number }): Record<string, string> {
  const { w, h } = viewport();
  const flipUp = pos.y + PILL_SIZE + POPOVER_GAP + 240 > h;
  const flipLeft = pos.x + POPOVER_W > w;
  const style: Record<string, string> = {};
  if (flipUp) style.bottom = `${PILL_SIZE + POPOVER_GAP}px`;
  else style.top = `${PILL_SIZE + POPOVER_GAP}px`;
  if (flipLeft) style.right = "0px";
  else style.left = "0px";
  return style;
}

function FunnelGlyph() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" class="text-foreground">
      <path
        d="M3 4h14l-5.2 6.2v4.3L8.2 17v-6.8L3 4z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  );
}
