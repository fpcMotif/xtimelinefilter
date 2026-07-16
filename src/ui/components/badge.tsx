import { cva, type VariantProps } from "class-variance-authority";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-transparent bg-secondary text-success",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = JSX.IntrinsicElements["span"] & VariantProps<typeof badgeVariants>;

export function Badge({ class: cls, className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" class={cn(badgeVariants({ variant }), cls, className)} {...props} />
  );
}
