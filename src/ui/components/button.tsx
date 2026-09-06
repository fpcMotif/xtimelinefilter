import * as stylex from "@stylexjs/stylex";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    whiteSpace: "nowrap",
    borderRadius: tokens.radiusMd,
    fontSize: tokens.textSm,
    fontWeight: "600",
    outline: "none",
    transitionProperty: "color, background-color, border-color, box-shadow",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    boxSizing: "border-box",
    ":focus-visible": {
      boxShadow: `0 0 0 2px oklch(from ${tokens.ring} l c h / 0.55)`,
    },
    ":disabled": {
      pointerEvents: "none",
      opacity: 0.5,
    },
  },
  default: {
    backgroundColor: {
      default: tokens.primary,
      ":hover": `oklch(from ${tokens.primary} l c h / 0.9)`,
    },
    color: tokens.primaryForeground,
    boxShadow: "0 1px 2px 0 oklch(0 0 0 / 0.05)",
  },
  secondary: {
    backgroundColor: {
      default: tokens.secondary,
      ":hover": `oklch(from ${tokens.secondary} l c h / 0.7)`,
    },
    color: tokens.secondaryForeground,
  },
  outline: {
    borderColor: {
      default: tokens.border,
      ":hover": tokens.faint,
    },
    backgroundColor: {
      default: "transparent",
      ":hover": `oklch(from ${tokens.secondary} l c h / 0.5)`,
    },
    color: tokens.foreground,
  },
  ghost: {
    backgroundColor: {
      default: "transparent",
      ":hover": `oklch(from ${tokens.secondary} l c h / 0.6)`,
    },
    color: {
      default: "inherit",
      ":hover": tokens.foreground,
    },
  },
  destructive: {
    borderColor: `oklch(from ${tokens.destructive} l c h / 0.5)`,
    color: tokens.destructive,
    backgroundColor: {
      default: "transparent",
      ":hover": `oklch(from ${tokens.destructive} l c h / 0.1)`,
    },
  },
  link: {
    color: tokens.primary,
    textUnderlineOffset: "4px",
    ":hover": {
      textDecoration: "underline",
    },
  },
  sizeDefault: {
    height: "2.25rem",
    paddingInline: "1rem",
    paddingBlock: "0.5rem",
  },
  sizeSm: {
    height: "2rem",
    borderRadius: tokens.radiusSm,
    paddingInline: "0.75rem",
    fontSize: tokens.textCompact,
  },
  sizeLg: {
    height: "2.5rem",
    borderRadius: tokens.radiusLg,
    paddingInline: "1.25rem",
    fontSize: tokens.textMd,
  },
  sizePill: {
    borderRadius: tokens.radiusFull,
    paddingInline: "1rem",
    paddingBlock: "0.375rem",
    fontSize: tokens.textCompact,
  },
  sizeIcon: {
    width: "2.25rem",
    height: "2.25rem",
    padding: 0,
  },
});

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "pill" | "icon";

const SIZES: Record<ButtonSize, keyof typeof styles> = {
  default: "sizeDefault",
  sm: "sizeSm",
  lg: "sizeLg",
  pill: "sizePill",
  icon: "sizeIcon",
};

export type ButtonProps = JSX.IntrinsicElements["button"] & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  sx?: stylex.StyleXStyles;
};

export function buttonVariants({
  variant = "default",
  size = "default",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = {}): string {
  return stylex.props(styles.base, styles[variant], styles[SIZES[size]]).className ?? "";
}

export function Button({
  class: cls,
  className,
  variant = "default",
  size = "default",
  type,
  sx,
  ...props
}: ButtonProps) {
  const styleProps = stylex.props(styles.base, styles[variant], styles[SIZES[size]], sx);
  return (
    <button
      type={type ?? "button"}
      data-slot="button"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}
