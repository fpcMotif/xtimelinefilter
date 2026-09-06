import * as stylex from "@stylexjs/stylex";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  input: {
    borderColor: tokens.input,
    backgroundColor: tokens.secondary,
    color: tokens.foreground,
    height: "2.25rem",
    width: "100%",
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: "solid",
    paddingInline: "0.75rem",
    fontSize: tokens.textSm,
    outline: "none",
    boxSizing: "border-box",
    transitionProperty: "color, box-shadow, border-color",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    "::placeholder": {
      color: tokens.faint,
      opacity: 1,
    },
    ":focus-visible": {
      borderColor: tokens.primary,
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.4)`,
    },
  },
});

export type InputProps = JSX.IntrinsicElements["input"] & {
  sx?: stylex.StyleXStyles;
};

export function Input({ class: cls, className, sx, ...props }: InputProps) {
  const styleProps = stylex.props(styles.input, sx);
  return (
    <input
      data-slot="input"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}
