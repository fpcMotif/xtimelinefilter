import * as stylex from "@stylexjs/stylex";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  card: {
    backgroundColor: tokens.card,
    color: tokens.cardForeground,
    borderColor: tokens.border,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: "1rem",
    display: "flex",
    flexDirection: "column",
    boxShadow: tokens.shadowElevated,
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: "0.375rem",
    paddingInline: "1.25rem",
    paddingTop: "1.25rem",
  },
  title: {
    fontSize: tokens.textBase,
    fontWeight: "700",
    letterSpacing: "-0.015em",
    margin: 0,
  },
  description: {
    color: tokens.mutedForeground,
    fontSize: tokens.textCompact,
    lineHeight: "1.625",
    margin: 0,
  },
  content: {
    paddingInline: "1.25rem",
    paddingTop: "0.75rem",
    paddingBottom: "1.25rem",
  },
});

export type CardProps = JSX.IntrinsicElements["div"] & {
  sx?: stylex.StyleXStyles;
};

export function Card({ class: cls, className, sx, ...props }: CardProps) {
  const styleProps = stylex.props(styles.card, sx);
  return (
    <div
      data-slot="card"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}

export type CardHeaderProps = JSX.IntrinsicElements["div"] & {
  sx?: stylex.StyleXStyles;
};

export function CardHeader({ class: cls, className, sx, ...props }: CardHeaderProps) {
  const styleProps = stylex.props(styles.header, sx);
  return (
    <div
      data-slot="card-header"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}

export type CardTitleProps = JSX.IntrinsicElements["h2"] & {
  sx?: stylex.StyleXStyles;
};

export function CardTitle({ class: cls, className, children, sx, ...props }: CardTitleProps) {
  const styleProps = stylex.props(styles.title, sx);
  return (
    <h2
      data-slot="card-title"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    >
      {children}
    </h2>
  );
}

export type CardDescriptionProps = JSX.IntrinsicElements["p"] & {
  sx?: stylex.StyleXStyles;
};

export function CardDescription({ class: cls, className, sx, ...props }: CardDescriptionProps) {
  const styleProps = stylex.props(styles.description, sx);
  return (
    <p
      data-slot="card-description"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}

export type CardContentProps = JSX.IntrinsicElements["div"] & {
  sx?: stylex.StyleXStyles;
};

export function CardContent({ class: cls, className, sx, ...props }: CardContentProps) {
  const styleProps = stylex.props(styles.content, sx);
  return (
    <div
      data-slot="card-content"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}
