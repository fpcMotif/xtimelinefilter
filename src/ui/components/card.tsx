import type { JSX } from "preact";

import { cn } from "@/lib/utils";

export function Card({ class: cls, className, ...props }: JSX.IntrinsicElements["div"]) {
  return (
    <div
      data-slot="card"
      class={cn(
        "bg-card text-card-foreground border-border flex flex-col rounded-2xl border shadow-[var(--shadow-elevated)]",
        cls,
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ class: cls, className, ...props }: JSX.IntrinsicElements["div"]) {
  return (
    <div
      data-slot="card-header"
      class={cn("flex flex-col gap-1.5 px-5 pt-5", cls, className)}
      {...props}
    />
  );
}

export function CardTitle({
  class: cls,
  className,
  children,
  ...props
}: JSX.IntrinsicElements["h2"]) {
  return (
    <h2
      data-slot="card-title"
      class={cn("text-[16px] font-bold tracking-tight", cls, className)}
      {...props}
    >
      {children}
    </h2>
  );
}

export function CardDescription({ class: cls, className, ...props }: JSX.IntrinsicElements["p"]) {
  return (
    <p
      data-slot="card-description"
      class={cn("text-muted-foreground text-compact leading-relaxed", cls, className)}
      {...props}
    />
  );
}

export function CardContent({ class: cls, className, ...props }: JSX.IntrinsicElements["div"]) {
  return <div data-slot="card-content" class={cn("px-5 pt-3 pb-5", cls, className)} {...props} />;
}
