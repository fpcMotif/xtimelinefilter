import * as stylex from "@stylexjs/stylex";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";
import { tokens } from "@/ui/tokens.stylex";

const styles = stylex.create({
  kbd: {
    borderColor: tokens.border,
    backgroundColor: tokens.secondary,
    color: tokens.foreground,
    display: "inline-flex",
    height: "1.25rem",
    minWidth: "1.25rem",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radiusSm,
    borderWidth: 1,
    borderStyle: "solid",
    paddingInline: "0.375rem",
    fontSize: tokens.text2xs,
    fontWeight: "500",
    boxSizing: "border-box",
  },
});

export type KbdProps = JSX.IntrinsicElements["kbd"] & {
  sx?: stylex.StyleXStyles;
};

export function Kbd({ class: cls, className, sx, ...props }: KbdProps) {
  const styleProps = stylex.props(styles.kbd, sx);
  return (
    <kbd
      data-slot="kbd"
      {...styleProps}
      class={cn(styleProps.className, cls, className)}
      {...props}
    />
  );
}
