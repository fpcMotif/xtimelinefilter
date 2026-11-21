import * as stylex from "@stylexjs/stylex";
import type { ComponentChildren } from "preact";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  label: {
    display: "flex",
    cursor: "pointer",
    alignItems: "flex-start",
    gap: "0.75rem",
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    paddingInline: "0.875rem",
    paddingBlock: "0.75rem",
    fontSize: tokens.textSm,
    lineHeight: "1.375",
    transitionProperty: "border-color, background-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    boxSizing: "border-box",
    ":hover": {
      borderColor: tokens.faint,
    },
  },
  labelChecked: {
    borderColor: tokens.primary,
    backgroundColor: tokens.secondary,
  },
  radio: {
    borderColor: tokens.faint,
    marginTop: "1px",
    width: "18px",
    height: "18px",
    flexShrink: 0,
    cursor: "pointer",
    appearance: "none",
    borderRadius: tokens.radiusFull,
    borderWidth: 1.5,
    borderStyle: "solid",
    outline: "none",
    boxSizing: "border-box",
    transitionProperty: "border-width, border-color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    ":checked": {
      borderColor: tokens.primary,
      borderWidth: 5,
    },
    ":focus-visible": {
      boxShadow: `0 0 0 1px var(--background), 0 0 0 3px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
  },
});

export interface RadioCardProps {
  name: string;
  value?: string;
  checked: boolean;
  onSelect: () => void;
  /** When a string, it doubles as the input's accessible name. */
  children: ComponentChildren;
  class?: string;
  className?: string;
  sx?: stylex.StyleXStyles;
}

export function RadioCard({
  name,
  value,
  checked,
  onSelect,
  children,
  class: cls,
  className,
  sx,
}: RadioCardProps) {
  const labelProps = stylex.props(styles.label, checked && styles.labelChecked, sx);
  const radioProps = stylex.props(styles.radio);

  return (
    <label data-slot="radio-card" {...labelProps} class={cn(labelProps.className, cls, className)}>
      <input
        type="radio"
        name={name}
        value={value}
        {...(typeof children === "string" ? { "aria-label": children } : {})}
        checked={checked}
        onChange={() => onSelect()}
        {...radioProps}
        class={radioProps.className}
      />
      {children}
    </label>
  );
}
