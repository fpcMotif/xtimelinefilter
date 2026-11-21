import * as stylex from "@stylexjs/stylex";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
    borderRadius: tokens.radiusFull,
    borderWidth: 1,
    borderStyle: "solid",
    paddingInline: "0.625rem",
    paddingBlock: "0.125rem",
    fontSize: tokens.text2xs,
    fontWeight: "600",
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  },
  default: {
    borderColor: "transparent",
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  secondary: {
    borderColor: "transparent",
    backgroundColor: tokens.secondary,
    color: tokens.secondaryForeground,
  },
  outline: {
    borderColor: tokens.border,
    color: tokens.mutedForeground,
  },
  success: {
    borderColor: "transparent",
    backgroundColor: tokens.secondary,
    color: tokens.success,
  },
});

export type BadgeVariant = "default" | "secondary" | "outline" | "success";

export type BadgeProps = JSX.IntrinsicElements["span"] & {
  variant?: BadgeVariant;
  sx?: stylex.StyleXStyles;
};

export function badgeVariants({ variant = "default" }: { variant?: BadgeVariant } = {}): string {
  return stylex.props(styles.base, styles[variant]).className ?? "";
}

export function Badge({ class: cls, className, variant = "default", sx, ...props }: BadgeProps) {
  const styleProps = stylex.props(styles.base, styles[variant], sx);
  return (
    <span
      data-slot="badge"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}
