import type { JSX } from "preact";

import { cn } from "@/lib/utils";

export function Kbd({ class: cls, className, ...props }: JSX.IntrinsicElements["kbd"]) {
  return (
    <kbd
      data-slot="kbd"
      class={cn(
        "border-border bg-secondary text-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1.5 text-[11px] font-medium",
        cls,
        className,
      )}
      {...props}
    />
  );
}
