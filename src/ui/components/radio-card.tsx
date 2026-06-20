import type { ComponentChildren } from "preact";

import { cn } from "@/lib/utils";

export interface RadioCardProps {
  name: string;
  value?: string;
  checked: boolean;
  onSelect: () => void;
  /** When a string, it doubles as the input's accessible name. */
  children: ComponentChildren;
  class?: string;
  className?: string;
}

/**
 * A selectable card backed by a native `<input type="radio">`. The copy lives as
 * a direct text child so the whole card's accessible name is the copy and
 * `getByText(copy).querySelector("input")` resolves the control — the contract
 * the options page tests rely on. The card highlights via `has-[:checked]`.
 */
export function RadioCard({
  name,
  value,
  checked,
  onSelect,
  children,
  class: cls,
  className,
}: RadioCardProps) {
  return (
    <label
      data-slot="radio-card"
      class={cn(
        "group border-border hover:border-faint has-[:checked]:border-primary has-[:checked]:bg-secondary flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-sm leading-snug transition-colors",
        cls,
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        {...(typeof children === "string" ? { "aria-label": children } : {})}
        checked={checked}
        onChange={() => onSelect()}
        class="border-faint checked:border-primary mt-px size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border-[1.5px] transition-[border-width,border-color] duration-150 checked:border-[5px]"
      />
      {children}
    </label>
  );
}
