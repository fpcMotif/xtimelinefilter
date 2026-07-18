import { useEffect, useRef, useState } from "preact/hooks";

import { activeCriteriaCount } from "@/core/filter-projection";
import type { Conduct, FilterStore } from "@/core/filter-store";
import { FilterPanel } from "@/ui/filter-panel";
import { useSignalValue } from "@/ui/use-signal-value";

/**
 * z-index for the funnel-pill layer. Distinct from — and below — the selection
 * `ActionBar` (which sits at 2147483646, see src/ui/ActionBar.tsx) so the two
 * floating surfaces never overlap (spec §5 / §10 coexistence).
 */
const PILL_Z = 2147483640;

const PILL_SIZE = 44;
const POPOVER_W = 320;
const POPOVER_GAP = 8;

export interface FunnelPillProps {
  store: FilterStore;
  hiddenCount: () => number;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
  /** Conduct in-page Filter commands through the controller's fail-open wall (passed to the panel). */
  conduct?: Conduct;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
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
  conduct,
}: FunnelPillProps) {
  const state = useSignalValue(store.state);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(position);
  const rootRef = useRef<HTMLDivElement>(null);
  // A drag's bookkeeping lives in the pointerdown closure; pointerup latches its
  // `moved` flag here so the trailing synthetic click can tell a drag from a tap.
  const suppressClick = useRef(false);

  // Keep local position in sync when the caller hands us a new persisted value.
  useEffect(() => setPos({ x: position.x, y: position.y }), [position.x, position.y]);

  // Escape + outside-click close the popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
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
      if (path.length > 0 && !inside) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [open]);

  function onPointerDown(e: PointerEvent) {
    const drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false, last: pos };
    const onMove = (ev: PointerEvent) => {
      const { w, h } = viewport();
      const next = {
        x: clamp(ev.clientX - drag.dx, 0, Math.max(0, w - PILL_SIZE)),
        y: clamp(ev.clientY - drag.dy, 0, Math.max(0, h - PILL_SIZE)),
      };
      if (next.x !== pos.x || next.y !== pos.y) drag.moved = true;
      drag.last = next;
      setPos(next); // live position is local state only — no persistence per move
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      suppressClick.current = drag.moved;
      // Persist ONCE on drop. onPositionChange writes chrome.storage.sync, which
      // Chrome caps at ~120 writes/min — reporting every pointermove burned the
      // whole quota in one drag and made every later settings/filter write fail
      // silently for minutes (the felt "state latency").
      if (drag.moved) onPositionChange(drag.last);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function onClick() {
    // Suppress the click that ends a drag so dragging never toggles the popover.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setOpen((v) => !v);
  }

  const enabled = state.enabled;
  const badge = enabled ? activeCriteriaCount(state) : 0;
  const popover = open ? popoverStyle(pos) : null;

  return (
    <div
      ref={rootRef}
      data-funnel-pill-root=""
      class="fixed"
      style={{ left: `${pos.x}px`, top: `${pos.y}px`, zIndex: PILL_Z }}
    >
      <button
        type="button"
        aria-label="Timeline filter"
        aria-expanded={open}
        data-enabled={String(enabled)}
        onPointerDown={onPointerDown}
        onClick={onClick}
        class="bg-card text-card-foreground shadow-elevated focus-visible:ring-ring/55 relative grid h-11 w-11 place-items-center rounded-full transition-[opacity,transform] duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
        style={{ opacity: enabled ? 1 : 0.5, touchAction: "none", cursor: "grab" }}
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
