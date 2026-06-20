import { cva, type VariantProps } from "class-variance-authority";
import type { JSX } from "preact";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/55 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        outline: "border border-border hover:border-faint hover:bg-secondary/50",
        ghost: "hover:bg-secondary/60 hover:text-foreground",
        destructive: "border border-destructive/50 text-destructive hover:bg-destructive/10",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-[13px]",
        lg: "h-10 rounded-xl px-5 text-[15px]",
        pill: "rounded-full px-4 py-1.5 text-[13px]",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = JSX.IntrinsicElements["button"] & VariantProps<typeof buttonVariants>;

export function Button({ class: cls, className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      data-slot="button"
      class={cn(buttonVariants({ variant, size }), cls, className)}
      {...props}
    />
  );
}
