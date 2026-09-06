import * as stylex from "@stylexjs/stylex";

import type { FilterPreset } from "@/core/filter-types";
import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  pill: {
    borderColor: {
      default: tokens.border,
      ":hover": tokens.faint,
    },
    color: {
      default: tokens.mutedForeground,
      ":hover": tokens.foreground,
    },
    backgroundColor: "transparent",
    borderRadius: tokens.radiusFull,
    borderWidth: 1,
    borderStyle: "solid",
    paddingInline: "0.625rem",
    paddingBlock: "0.25rem",
    fontSize: tokens.textXs,
    fontWeight: "500",
    transitionProperty: "transform, color, border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    outline: "none",
    boxSizing: "border-box",
    cursor: "pointer",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":active": {
      transform: "scale(0.96)",
    },
  },
});

export interface PresetApplyPillProps {
  preset: FilterPreset;
  onApply: (id: string) => void;
  class?: string;
  className?: string;
  sx?: stylex.StyleXStyles;
}

/**
 * One saved preset rendered as a tap-to-apply chip — the single apply control
 * shared by the in-page <FilterPanel> and the toolbar popup, so the pill styling
 * lives in one place. Each surface wires its own store through {@link onApply}.
 */
export function PresetApplyPill({
  preset,
  onApply,
  class: cls,
  className,
  sx,
}: PresetApplyPillProps) {
  const styleProps = stylex.props(styles.pill, sx);
  return (
    <button
      type="button"
      data-slot="preset-apply-pill"
      onClick={() => onApply(preset.id)}
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
    >
      {preset.name}
    </button>
  );
}
