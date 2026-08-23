import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Omit when an enclosing <label>'s text already names it. */
  label?: string;
  /** id of the element that describes the control (aria-describedby). */
  describedBy?: string;
  id?: string;
  class?: string;
  className?: string;
}

/**
 * A tactile on/off toggle backed by a *real* `<input type="checkbox">` (styled,
 * not replaced) so the accessibility contracts hold: `getByLabelText(label)`
 * resolves to the input and `fireEvent.click` toggles it like a bare checkbox.
 */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  id,
  class: cls,
  className,
}: SwitchProps) {
  return (
    <span
      data-slot="switch"
      class={cn("relative inline-flex h-[22px] w-[38px] shrink-0", cls, className)}
    >
      <input
        id={id}
        type="checkbox"
        {...(label ? { "aria-label": label } : {})}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        checked={checked}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        class="peer focus-visible:ring-ring/55 absolute inset-0 z-10 m-0 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      />
      <span
        aria-hidden="true"
        class="border-border bg-secondary peer-checked:border-primary peer-checked:bg-primary pointer-events-none absolute inset-0 rounded-full border transition-colors"
      />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-[3px] left-[3px] size-4 rounded-full bg-white/75 shadow-sm transition-transform duration-200 ease-out peer-checked:translate-x-4 peer-checked:bg-white"
      />
    </span>
  );
}
