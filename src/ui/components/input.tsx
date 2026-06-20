import type { JSX } from "preact";

import { cn } from "@/lib/utils";

export function Input({ class: cls, className, ...props }: JSX.IntrinsicElements["input"]) {
  return (
    <input
      data-slot="input"
      class={cn(
        "border-input bg-secondary text-foreground placeholder:text-faint focus-visible:border-primary focus-visible:ring-ring/40 h-9 w-full rounded-lg border px-3 text-sm outline-none transition-[color,box-shadow,border-color] focus-visible:ring-2",
        cls,
        className,
      )}
      {...props}
    />
  );
}
